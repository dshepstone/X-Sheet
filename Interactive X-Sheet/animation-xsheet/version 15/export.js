/**
 * export.js - Export and printing functionality for Animation X‑Sheet
 * Handles PDF export and printing with improved reliability
 *
 * 2025‑05‑09 — transparency patch
 *   • html2canvas backgroundColor set to null so PDF keeps drawing‑layer transparency
 */

window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Export = window.XSheetApp.Export || {};

(function (app) {
    'use strict';

    /* ------------------------------------------------------------------ *
     *  Init
     * ------------------------------------------------------------------ */
    function init() {
        document.addEventListener('xsheet-export-pdf', exportToPDF);
        document.addEventListener('xsheet-print', printSheet);
    }

    /* ------------------------------------------------------------------ *
     *  Drawing‑layer helpers
     * ------------------------------------------------------------------ */

    function recalculateDrawingLayerPosition() {
        if (!app.Drawing?.state?.layerSystem) {
            console.warn('Drawing system not available for recalculation.');
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const printableArea = document.getElementById('printable-area');
        const table = document.getElementById('xsheet-table');

        if (!table || !printableArea || !layerContainer) {
            console.warn('Required elements not found for drawing layer recalculation.');
            return;
        }

        /* force layout flush before measuring */
        document.body.offsetHeight;
        printableArea.offsetHeight;
        table.offsetHeight;
        layerContainer.offsetHeight;

        const tableRect = table.getBoundingClientRect();
        const printableRect = printableArea.getBoundingClientRect();

        Object.assign(layerContainer.style, {
            position: 'absolute',
            top: (tableRect.top - printableRect.top) + 'px',
            left: (tableRect.left - printableRect.left) + 'px',
            width: tableRect.width + 'px',
            height: tableRect.height + 'px',
            zIndex: '1000',
            backgroundColor: 'transparent',
            opacity: '1',
            display: 'block'
        });

        /* resize canvases & redraw */
        layerSystem.layers.forEach(layer => {
            const c = layer.canvas;
            c.style.backgroundColor = 'transparent';
            c.width = tableRect.width;
            c.height = tableRect.height;
        });

        layerSystem.redrawAll();

        console.log('Drawing layer repositioned for print mode.',
            'Top:', layerContainer.style.top,
            'Left:', layerContainer.style.left,
            'W:', layerContainer.style.width,
            'H:', layerContainer.style.height);
    }

    function prepareDrawingLayersForExport() {
        if (!app.Drawing?.state?.layerSystem) {
            console.warn('Drawing system not available for export preparation.');
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        /* save original style/parent */
        layerContainer._originalDisplay = layerContainer.style.display;
        layerContainer._originalPos = layerContainer.style.position;
        layerContainer._originalTop = layerContainer.style.top;
        layerContainer._originalLeft = layerContainer.style.left;
        layerContainer._originalZIndex = layerContainer.style.zIndex;
        layerContainer._originalWidth = layerContainer.style.width;
        layerContainer._originalHeight = layerContainer.style.height;
        layerContainer._originalParent = layerContainer.parentNode;

        layerSystem.layers.forEach(layer => {
            layer.canvas._originalWidth = layer.canvas.width;
            layer.canvas._originalHeight = layer.canvas.height;
        });

        layerContainer.style.display = 'block';

        const printableArea = document.getElementById('printable-area');
        if (!printableArea) {
            console.error('Printable area not found for moving drawing layer.');
            return;
        }
        printableArea.appendChild(layerContainer);

        console.log('Drawing layers prepared for export (moved to printable‑area).');
    }

    function restoreDrawingLayers() {
        if (!app.Drawing?.state?.layerSystem) return;

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        if (layerContainer._originalParent) {
            Object.assign(layerContainer.style, {
                display: layerContainer._originalDisplay,
                position: layerContainer._originalPos,
                top: layerContainer._originalTop,
                left: layerContainer._originalLeft,
                zIndex: layerContainer._originalZIndex,
                width: layerContainer._originalWidth,
                height: layerContainer._originalHeight
            });

            layerSystem.layers.forEach(layer => {
                if (layer.canvas._originalWidth !== undefined) {
                    layer.canvas.width = layer.canvas._originalWidth;
                    layer.canvas.height = layer.canvas._originalHeight;
                    delete layer.canvas._originalWidth;
                    delete layer.canvas._originalHeight;
                }
            });

            layerContainer._originalParent.appendChild(layerContainer);
            layerSystem.redrawAll();

            /* cleanup refs */
            [
                '_originalDisplay', '_originalPos', '_originalTop', '_originalLeft',
                '_originalZIndex', '_originalWidth', '_originalHeight', '_originalParent'
            ].forEach(k => delete layerContainer[k]);

            console.log('Drawing layers restored to original state.');
        }
    }

    /* ------------------------------------------------------------------ *
     *  UI hide / show helpers
     * ------------------------------------------------------------------ */

    function hideUIControls() {
        [
            '.controls',
            '#audio-controls',
            '.status',
            '#phonetic-input',
            '.drawing-toolbar',
            '#drawing-toolbar-container'
        ].forEach(sel => document.querySelector(sel)?.style && (document.querySelector(sel).style.display = 'none'));
    }

    function showUIControls() {
        const list = [
            { sel: '.controls', display: 'flex' },
            { sel: '#audio-controls', display: 'flex' },
            { sel: '.status', display: 'block' },
            { sel: '.drawing-toolbar', display: 'flex' },
            { sel: '#drawing-toolbar-container', display: 'block' }
        ];
        list.forEach(({ sel, display }) => {
            const el = document.querySelector(sel);
            if (el) el.style.display = display;
        });
    }

    /* ------------------------------------------------------------------ *
     *  Selection/metadata save & restore
     * ------------------------------------------------------------------ */

    function saveSelectionState() {
        const selectedCells = document.querySelectorAll('.selected-cell');
        const tableBody = document.getElementById('xsheet-body');

        const data = {
            selectedIndices: Array.from(selectedCells).map(cell => {
                const row = cell.closest('tr');
                return {
                    rowIndex: Array.from(tableBody.children).indexOf(row),
                    colIndex: Array.from(row.children).indexOf(cell)
                };
            }),
            metadata: {
                projectNumber: document.getElementById('project-number').value,
                date: document.getElementById('project-date').value,
                pageNumber: document.getElementById('page-number').value,
                animatorName: document.getElementById('animator-name').value,
                versionNumber: document.getElementById('version-number').value,
                shotNumber: document.getElementById('shot-number').value
            },
            cellContents: []
        };

        document.querySelectorAll('.waveform-col').forEach(cell =>
            cell.setAttribute('data-original-content', cell.innerHTML));

        document.querySelectorAll('#xsheet-body [contenteditable="true"]').forEach(cell => {
            const row = cell.closest('tr');
            const rowIndex = Array.from(tableBody.children).indexOf(row);
            const colIndex = Array.from(row.children).indexOf(cell);
            data.cellContents.push({
                rowIndex, colIndex,
                content: cell.innerHTML,
                isModified: cell.classList.contains('modified')
            });
        });

        return data;
    }

    function restoreSelectionState(data) {
        if (!data?.selectedIndices) return;

        app.clearCellSelection?.();  // from core.js
        const tableBody = document.getElementById('xsheet-body');

        data.selectedIndices.forEach(({ rowIndex, colIndex }) => {
            const row = tableBody.children[rowIndex];
            const cell = row?.children[colIndex];
            if (cell?.contentEditable === 'true') {
                cell.classList.add('selected-cell');
                if (app.state?.selectedCells && !app.state.selectedCells.includes(cell)) {
                    app.state.selectedCells.push(cell);
                }
            }
        });
    }

    /* ------------------------------------------------------------------ *
     *  Post‑export / post‑print cleanup
     * ------------------------------------------------------------------ */

    function cleanupAfterExport(savedData) {
        showUIControls();
        restoreDrawingLayers();
        app.restoreData?.(savedData);

        document.querySelectorAll('.waveform-col').forEach(cell => {
            const original = cell.getAttribute('data-original-content');
            if (original !== null) {
                cell.innerHTML = original;
                cell.removeAttribute('data-original-content');
            }
        });
    }

    function cleanupAfterPrint(tableData, originalBodyStyle) {
        showUIControls();
        document.querySelector('.waveform-container')?.style && (
            document.querySelector('.waveform-container').style.display = '');

        restoreDrawingLayers();

        /* restore waveform col html */
        document.querySelectorAll('.waveform-col').forEach(cell => {
            const original = cell.getAttribute('data-original-content');
            if (original !== null) {
                cell.innerHTML = original;
                cell.removeAttribute('data-original-content');
            }
        });

        /* restore edited cell contents & metadata */
        if (tableData?.cellContents) {
            const tableBody = document.getElementById('xsheet-body');
            tableData.cellContents.forEach(({ rowIndex, colIndex, content, isModified }) => {
                const row = tableBody.children[rowIndex];
                const cell = row?.children[colIndex];
                if (cell && cell.contentEditable === 'true' && !cell.classList.contains('waveform-col')) {
                    cell.innerHTML = content;
                    cell.classList.toggle('modified', !!isModified);
                }
            });
        }

        if (tableData?.metadata) {
            document.getElementById('project-number').value = tableData.metadata.projectNumber || '';
            document.getElementById('project-date').value = tableData.metadata.date || '';
            document.getElementById('page-number').value = tableData.metadata.pageNumber || '';
            document.getElementById('animator-name').value = tableData.metadata.animatorName || '';
            document.getElementById('version-number').value = tableData.metadata.versionNumber || '';
            document.getElementById('shot-number').value = tableData.metadata.shotNumber || '';
        }

        restoreSelectionState(tableData);

        document.body.setAttribute('style', originalBodyStyle);
        document.body.offsetHeight;
    }

    /* ------------------------------------------------------------------ *
     *  Export to PDF
     * ------------------------------------------------------------------ */

    function exportToPDF() {
        const savedData = app.collectData ? app.collectData() : {};
        app.updateStatusMessage('Preparing PDF. Please wait…');

        prepareDrawingLayersForExport();
        app.Audio?.drawWaveformInCells?.();
        hideUIControls();

        document.body.classList.add('print-mode');
        document.body.offsetHeight;

        const observer = new MutationObserver((m, obs) => {
            obs.disconnect();

            document.body.offsetHeight;
            recalculateDrawingLayerPosition();

            setTimeout(() => {
                try {
                    html2canvas(document.getElementById('printable-area'), {
                        scale: 1.5,
                        useCORS: true,
                        logging: false,
                        allowTaint: true,
                        backgroundColor: null          //  << transparency fix
                    }).then(canvas => {
                        const imgData = canvas.toDataURL('image/png');
                        const { jsPDF } = window.jspdf;

                        const large = app.state.currentTemplate === 'large';
                        const pdf = new jsPDF({
                            orientation: 'portrait',
                            unit: 'mm',
                            format: [large ? 279.4 : 215.9, large ? 431.8 : 279.4]
                        });

                        const props = pdf.getImageProperties(imgData);
                        const pageW = pdf.internal.pageSize.getWidth() - 20;
                        const pageH = pdf.internal.pageSize.getHeight() - 20;
                        const ratio = Math.min(pageW / props.width, pageH / props.height);

                        pdf.addImage(imgData, 'PNG', 10, 10,
                            props.width * ratio, props.height * ratio);
                        pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                    }).catch(err => {
                        console.error('HTML2Canvas error:', err);
                        app.updateStatusMessage('Error creating PDF: ' + err.message);
                    }).finally(() => {
                        document.body.classList.remove('print-mode');
                        cleanupAfterExport(savedData);
                    });
                } catch (err) {
                    console.error('Error exporting PDF:', err);
                    app.updateStatusMessage('Error exporting PDF: ' + err.message);
                    document.body.classList.remove('print-mode');
                    cleanupAfterExport(savedData);
                }
            }, 250);
        });

        observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: ['class', 'style']
        });

        /* fallback if MutationObserver never fires */
        setTimeout(() => {
            if (document.body.classList.contains('print-mode') && observer) {
                console.warn('PDF export MutationObserver fallback triggered.');
                observer.disconnect();

                document.body.offsetHeight;
                recalculateDrawingLayerPosition();

                setTimeout(() => {
                    try {
                        html2canvas(document.getElementById('printable-area'), {
                            scale: 1.5,
                            useCORS: true,
                            logging: false,
                            allowTaint: true,
                            backgroundColor: null    //  << transparency fix (fallback)
                        }).then(canvas => {
                            const imgData = canvas.toDataURL('image/png');
                            const { jsPDF } = window.jspdf;

                            const large = app.state.currentTemplate === 'large';
                            const pdf = new jsPDF({
                                orientation: 'portrait',
                                unit: 'mm',
                                format: [large ? 279.4 : 215.9, large ? 431.8 : 279.4]
                            });

                            const props = pdf.getImageProperties(imgData);
                            const pageW = pdf.internal.pageSize.getWidth() - 20;
                            const pageH = pdf.internal.pageSize.getHeight() - 20;
                            const ratio = Math.min(pageW / props.width, pageH / props.height);

                            pdf.addImage(imgData, 'PNG', 10, 10,
                                props.width * ratio, props.height * ratio);
                            pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                        }).catch(err => {
                            console.error('HTML2Canvas error (fallback):', err);
                            app.updateStatusMessage('Error creating PDF (fallback): ' + err.message);
                        }).finally(() => {
                            document.body.classList.remove('print-mode');
                            cleanupAfterExport(savedData);
                        });
                    } catch (err) {
                        console.error('Error exporting PDF (fallback):', err);
                        app.updateStatusMessage('Error exporting PDF (fallback): ' + err.message);
                        document.body.classList.remove('print-mode');
                        cleanupAfterExport(savedData);
                    }
                }, 250);
            }
        }, 500);
    }

    /* ------------------------------------------------------------------ *
     *  Print sheet
     * ------------------------------------------------------------------ */

    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait…');

        const tableData = saveSelectionState();
        const originalBodyStyle = document.body.getAttribute('style') || '';

        prepareDrawingLayersForExport();
        app.Audio?.drawWaveformInCells?.();
        hideUIControls();

        document.body.classList.add('print-mode');
        document.body.offsetHeight;

        let printFallbackTimeout;

        const observer = new MutationObserver((m, obs) => {
            obs.disconnect();
            clearTimeout(printFallbackTimeout);

            document.body.offsetHeight;
            recalculateDrawingLayerPosition();

            setTimeout(() => {
                window.print();

                setTimeout(() => {
                    document.body.classList.remove('print-mode');
                    cleanupAfterPrint(tableData, originalBodyStyle);
                    app.updateStatusMessage('Print complete');
                }, 2000);
            }, 250);
        });

        observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: ['class', 'style']
        });

        printFallbackTimeout = setTimeout(() => {
            if (document.body.classList.contains('print-mode') && observer) {
                console.warn('Print sheet MutationObserver fallback triggered.');
                observer.disconnect();

                document.body.offsetHeight;
                recalculateDrawingLayerPosition();

                setTimeout(() => {
                    window.print();
                    setTimeout(() => {
                        document.body.classList.remove('print-mode');
                        cleanupAfterPrint(tableData, originalBodyStyle);
                        app.updateStatusMessage('Print complete (fallback)');
                    }, 2000);
                }, 250);
            }
        }, 1000);
    }

    /* ------------------------------------------------------------------ */
    app.Export = { init, exportToPDF, printSheet };
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);

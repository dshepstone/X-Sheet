/**
 * export.js - Export and printing functionality for Animation X-Sheet
 * Handles PDF export and printing with improved reliability
 */

// Create namespace for the export module
window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Export = window.XSheetApp.Export || {};

(function (app) {
    'use strict';

    let isExportingPDF = false; // Guard to prevent double PDF export
    let isPrinting = false; // Guard for printing

    // Initialize export functionality
    function init() {
        // Ensure listeners are added only once
        document.removeEventListener('xsheet-export-pdf', handleExportPDFEvent);
        document.addEventListener('xsheet-export-pdf', handleExportPDFEvent);

        document.removeEventListener('xsheet-print', handlePrintEvent);
        document.addEventListener('xsheet-print', handlePrintEvent);
    }

    function handleExportPDFEvent() {
        if (isExportingPDF) {
            console.warn("PDF export already in progress.");
            return;
        }
        isExportingPDF = true;
        exportToPDF().finally(() => {
            isExportingPDF = false; // Reset guard
        });
    }

    function handlePrintEvent() {
        if (isPrinting) {
            console.warn("Print operation already in progress.");
            return;
        }
        isPrinting = true;
        printSheet(); // Not async, but cleanup relies on async dialog
        // Guard for printing will be reset in the cleanup phase
    }

    // Export to PDF functionality
    async function exportToPDF() { // Make it async to use await and .finally
        app.updateStatusMessage('Preparing PDF. Please wait...');
        const savedData = app.collectData();

        prepareForExport();
        document.body.classList.add('print-mode');

        // Use a promise to manage delays and ensure proper sequencing
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                document.body.offsetHeight; // Force reflow
                recalculateDrawingLayerPosition();

                setTimeout(async () => { // Make inner timeout async for html2canvas
                    try {
                        const printableElement = document.getElementById('printable-area');
                        const canvas = await html2canvas(printableElement, {
                            scale: 1.5, // Reduced scale from 2 to 1.5 to reduce file size
                            useCORS: true,
                            logging: false,
                            allowTaint: true,
                            backgroundColor: '#ffffff',
                            scrollX: -window.scrollX,
                            scrollY: -window.scrollY,
                            windowWidth: printableElement.scrollWidth,
                            windowHeight: printableElement.scrollHeight
                        });

                        const imgData = canvas.toDataURL('image/png');
                        const { jsPDF } = window.jspdf;

                        const pdfWidth = 215.9;
                        const pdfHeight = 279.4;
                        const margin = 12.7; // 0.5 inch margin in mm

                        const contentWidth = pdfWidth - (2 * margin);
                        const contentHeight = pdfHeight - (2 * margin);

                        const pdf = new jsPDF({
                            orientation: 'portrait',
                            unit: 'mm',
                            format: 'letter'
                        });

                        const imgProps = pdf.getImageProperties(imgData); // Use built-in properties
                        // const imgAspectRatio = imgProps.width / imgProps.height; // Not directly needed for slicing based on fixed PDF page size

                        let numPages = Math.ceil(imgProps.height / (contentHeight * (imgProps.width / contentWidth)));
                        if (numPages === 0) numPages = 1;


                        for (let i = 0; i < numPages; i++) {
                            if (i > 0) {
                                pdf.addPage();
                            }

                            let sourceImgSliceY = i * (contentHeight * (imgProps.width / contentWidth));
                            let sourceImgSliceHeight = contentHeight * (imgProps.width / contentWidth);

                            // Adjust slice height for the last page
                            if (sourceImgSliceY + sourceImgSliceHeight > imgProps.height) {
                                sourceImgSliceHeight = imgProps.height - sourceImgSliceY;
                            }
                            // Prevent sliceHeight from being 0 or negative
                            if (sourceImgSliceHeight <= 0) continue;


                            const tempCanvas = document.createElement('canvas');
                            tempCanvas.width = imgProps.width;
                            tempCanvas.height = sourceImgSliceHeight;
                            const tempCtx = tempCanvas.getContext('2d');

                            tempCtx.drawImage(canvas, 0, sourceImgSliceY, imgProps.width, sourceImgSliceHeight, 0, 0, imgProps.width, sourceImgSliceHeight);

                            const pageImgData = tempCanvas.toDataURL('image/png');
                            const actualSlicePdfHeight = sourceImgSliceHeight * (contentWidth / imgProps.width);

                            pdf.addImage(pageImgData, 'PNG', margin, margin, contentWidth, actualSlicePdfHeight);
                        }

                        pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                        app.updateStatusMessage('PDF exported successfully.');
                        resolve();
                    } catch (err) {
                        console.error('Error during PDF creation or saving:', err);
                        app.updateStatusMessage('Error creating PDF: ' + err.message);
                        reject(err);
                    } finally {
                        document.body.classList.remove('print-mode');
                        cleanupAfterExport(savedData);
                    }
                }, 350);
            }, 500);
        });
    }

    // Print functionality
    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');

        const tableData = saveSelectionState();
        const originalBodyClassName = document.body.className;

        prepareForExport();

        setTimeout(() => {
            document.body.classList.add('print-mode');
            document.body.offsetHeight;

            const table = document.getElementById('xsheet-table');
            if (table) table.offsetHeight;

            recalculateDrawingLayerPosition();

            setTimeout(() => {
                window.print();
            }, 50);


            const cleanup = () => {
                document.body.classList.remove('print-mode');
                document.body.className = originalBodyClassName;
                cleanupAfterPrint(tableData);
                app.updateStatusMessage('Print job sent.');
                window.removeEventListener('afterprint', cleanup);
                document.removeEventListener('keyup', escapeListener);
                isPrinting = false; // Reset guard
            };

            const escapeListener = (e) => {
                if (e.key === "Escape") {
                    console.log("Print dialog likely cancelled by Escape key.");
                    cleanup();
                }
            };

            if (window.onafterprint !== undefined) {
                window.addEventListener('afterprint', cleanup, { once: true });
            } else {
                setTimeout(cleanup, 3000);
            }

            setTimeout(() => {
                document.addEventListener('keyup', escapeListener, { once: true });
            }, 200);


        }, 500);
    }

    // Prepare document for export/print
    function prepareForExport() {
        if (app.Audio && app.Audio.state.audioBuffer && app.Audio.state.waveformData.length > 0) {
            app.Audio.drawWaveformInCells();
        }
        prepareDrawingLayersForExport();
    }

    function prepareDrawingLayersForExport() {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        if (layerContainer._originalParent === undefined) {
            layerContainer._originalDisplay = layerContainer.style.display;
            layerContainer._originalPos = layerContainer.style.position;
            layerContainer._originalTop = layerContainer.style.top;
            layerContainer._originalLeft = layerContainer.style.left;
            layerContainer._originalZIndex = layerContainer.style.zIndex;
            layerContainer._originalWidth = layerContainer.style.width;
            layerContainer._originalHeight = layerContainer.style.height;
            layerContainer._originalParent = layerContainer.parentNode;
        }

        layerContainer.style.display = 'block';

        const printableArea = document.getElementById('printable-area');
        if (layerContainer.parentNode !== printableArea) {
            printableArea.appendChild(layerContainer);
        }
        layerContainer._tableRef = document.getElementById('xsheet-table');
    }

    function recalculateDrawingLayerPosition() {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const table = layerContainer._tableRef || document.getElementById('xsheet-table');
        const printableArea = document.getElementById('printable-area');

        if (!table || !layerContainer.parentNode || !printableArea) return;

        if (layerContainer.parentNode !== printableArea) {
            printableArea.appendChild(layerContainer);
        }

        let topOffset = table.offsetTop;
        let leftOffset = table.offsetLeft;

        layerContainer.style.position = 'absolute';
        layerContainer.style.top = topOffset + 'px';
        layerContainer.style.left = leftOffset + 'px';
        layerContainer.style.width = table.offsetWidth + 'px';
        layerContainer.style.height = table.offsetHeight + 'px';
        layerContainer.style.zIndex = '10';
    }

    function saveSelectionState() {
        const selectedCells = Array.from(document.querySelectorAll('.selected-cell'));
        const tableData = {
            selectedIndices: selectedCells.map(cell => {
                const row = cell.closest('tr');
                const rowIndex = row ? Array.from(document.getElementById('xsheet-body').children).indexOf(row) : -1;
                const colIndex = row ? Array.from(row.children).indexOf(cell) : -1;
                return { rowIndex, colIndex };
            }),
            metadata: {},
            cellContents: []
        };

        const metadataIds = ['project-number', 'project-date', 'page-number', 'animator-name', 'version-number', 'shot-number'];
        metadataIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) tableData.metadata[id] = el.value;
        });

        const waveformCells = document.querySelectorAll('.waveform-col');
        waveformCells.forEach(cell => {
            cell.setAttribute('data-original-content', cell.innerHTML);
        });

        const allEditableCells = document.querySelectorAll('[contenteditable="true"]');
        allEditableCells.forEach(cell => {
            const row = cell.closest('tr');
            if (row) {
                const rowIndex = Array.from(document.getElementById('xsheet-body').children).indexOf(row);
                const colIndex = Array.from(row.children).indexOf(cell);
                tableData.cellContents.push({
                    rowIndex,
                    colIndex,
                    content: cell.innerHTML,
                    isModified: cell.classList.contains('modified')
                });
            }
        });

        return tableData;
    }

    function restoreSelectionState(tableData) {
        if (!tableData || !tableData.selectedIndices) return;

        if (app.clearCellSelection) app.clearCellSelection();

        const tableBody = document.getElementById('xsheet-body');
        if (!tableBody) return;

        tableData.selectedIndices.forEach(index => {
            if (index.rowIndex >= 0 && tableBody.children[index.rowIndex]) {
                const row = tableBody.children[index.rowIndex];
                if (index.colIndex >= 0 && row.children[index.colIndex]) {
                    const cell = row.children[index.colIndex];
                    if (cell.contentEditable === 'true') {
                        if (app.XSheetApp && app.XSheetApp.state && app.XSheetApp.state.selectedCells) {
                            app.XSheetApp.state.selectedCells.push(cell);
                        }
                        cell.classList.add('selected-cell');
                    }
                }
            }
        });
    }

    function cleanupAfterExport(savedData) {
        restoreDrawingLayers();
        if (app.restoreData && savedData) {
            app.restoreData(savedData);
        }
        app.updateStatusMessage("Export cleanup complete.");
    }

    function cleanupAfterPrint(tableData) {
        restoreDrawingLayers();

        const tableBody = document.getElementById('xsheet-body');

        const waveformCells = document.querySelectorAll('.waveform-col');
        waveformCells.forEach(cell => {
            const originalContent = cell.getAttribute('data-original-content');
            if (originalContent !== null) {
                cell.innerHTML = originalContent;
                cell.removeAttribute('data-original-content');
            }
        });

        if (tableData && tableData.cellContents && tableBody) {
            tableData.cellContents.forEach(cellData => {
                if (cellData.rowIndex >= 0 && tableData.rowIndex < tableBody.children.length && tableBody.children[cellData.rowIndex]) { // check length
                    const row = tableBody.children[cellData.rowIndex];
                    if (cellData.colIndex >= 0 && cellData.colIndex < row.children.length && row.children[cellData.colIndex]) { // check length
                        const cell = row.children[cellData.colIndex];
                        if (!cell.classList.contains('waveform-col') && cell.contentEditable === 'true') {
                            cell.innerHTML = cellData.content;
                            if (cellData.isModified) cell.classList.add('modified');
                            else cell.classList.remove('modified');
                        }
                    }
                }
            });
        }

        if (tableData && tableData.metadata) {
            Object.keys(tableData.metadata).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = tableData.metadata[id] || '';
            });
        }

        restoreSelectionState(tableData);

        document.body.offsetHeight;
        app.updateStatusMessage('Print cleanup complete.');
    }

    function restoreDrawingLayers() {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }

        const layerContainer = app.Drawing.state.layerSystem.container;

        if (layerContainer._originalParent !== undefined) {
            layerContainer.style.display = layerContainer._originalDisplay;
            layerContainer.style.position = layerContainer._originalPos;
            layerContainer.style.top = layerContainer._originalTop;
            layerContainer.style.left = layerContainer._originalLeft;
            layerContainer.style.zIndex = layerContainer._originalZIndex;
            layerContainer.style.width = layerContainer._originalWidth;
            layerContainer.style.height = layerContainer._originalHeight;

            if (layerContainer._originalParent && layerContainer.parentNode !== layerContainer._originalParent) {
                layerContainer._originalParent.appendChild(layerContainer);
            }

            delete layerContainer._originalDisplay;
            delete layerContainer._originalPos;
            delete layerContainer._originalTop;
            delete layerContainer._originalLeft;
            delete layerContainer._originalZIndex;
            delete layerContainer._originalWidth;
            delete layerContainer._originalHeight;
            delete layerContainer._originalParent;
            delete layerContainer._tableRef;
        }

        if (app.Drawing.state.layerSystem.updateLayoutSize) {
            app.Drawing.state.layerSystem.updateLayoutSize();
        }
    }

    // Public API
    app.Export = {
        init
        // exportToPDF is called by handleExportPDFEvent
        // printSheet is called by handlePrintEvent
    };

    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);
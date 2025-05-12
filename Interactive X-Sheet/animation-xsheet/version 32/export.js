/**
 * export.js - Export and printing functionality for Animation X-Sheet
 * Handles PDF export and printing with improved reliability
 */

// Create namespace for the export module
window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Export = window.XSheetApp.Export || {};

(function (app) {
    'use strict';

    let isExportingPDF = false;
    let isPrinting = false;

    function init() {
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
            isExportingPDF = false;
        });
    }

    function handlePrintEvent() {
        if (isPrinting) {
            console.warn("Print operation already in progress.");
            return;
        }
        isPrinting = true;
        printSheet();
    }

    async function exportToPDF() {
        app.updateStatusMessage('Preparing PDF. Please wait...');
        const savedData = app.collectData();
        const printableElement = document.getElementById('printable-area');

        // Temporarily adjust printableElement style for full width capture if needed
        const originalPrintableStyle = printableElement.getAttribute('style') || '';
        // printableElement.style.width = '100%'; // Ensure it tries to use full available width
        // printableElement.style.maxWidth = 'none'; // Override any max-width from screen styles

        prepareForExport(); // Moves drawing layer, etc.
        document.body.classList.add('print-mode');

        return new Promise((resolve, reject) => {
            setTimeout(() => {
                document.body.offsetHeight;
                recalculateDrawingLayerPosition();

                setTimeout(async () => {
                    try {
                        // Get the bounding box of the printable area to pass to html2canvas
                        const rect = printableElement.getBoundingClientRect();

                        const canvas = await html2canvas(printableElement, {
                            scale: 1.5,
                            useCORS: true,
                            logging: false,
                            allowTaint: true,
                            backgroundColor: '#ffffff',
                            x: rect.left, // Capture from the element's actual left
                            y: rect.top,  // Capture from the element's actual top
                            width: rect.width, // Capture only the element's width
                            height: rect.height, // Capture only the element's height
                            scrollX: 0, // Should be 0 if using x,y,width,height from getBoundingClientRect
                            scrollY: 0,
                            windowWidth: document.documentElement.scrollWidth, // Give context of full page
                            windowHeight: document.documentElement.scrollHeight
                        });

                        // Restore printableElement style
                        // printableElement.setAttribute('style', originalPrintableStyle);


                        const imgData = canvas.toDataURL('image/png');
                        const { jsPDF } = window.jspdf;

                        const pdfWidth = 215.9;
                        const pdfHeight = 279.4;
                        const margin = 10; // Reduced margin slightly for more content space

                        const contentWidth = pdfWidth - (2 * margin);
                        const contentHeight = pdfHeight - (2 * margin);

                        const pdf = new jsPDF({
                            orientation: 'portrait',
                            unit: 'mm',
                            format: 'letter'
                        });

                        const imgProps = pdf.getImageProperties(imgData);

                        // Calculate how many pixels of the source canvas fit into one PDF page's content height
                        const pixelsPerPdfPage = contentHeight * (imgProps.width / contentWidth);
                        const numPages = Math.ceil(imgProps.height / pixelsPerPdfPage);

                        for (let i = 0; i < numPages; i++) {
                            if (i > 0) {
                                pdf.addPage();
                            }

                            let sourceImgSliceY = i * pixelsPerPdfPage;
                            let sourceImgSliceHeight = Math.min(pixelsPerPdfPage, imgProps.height - sourceImgSliceY);

                            if (sourceImgSliceHeight <= 0) continue;

                            const tempCanvas = document.createElement('canvas');
                            tempCanvas.width = imgProps.width;
                            tempCanvas.height = sourceImgSliceHeight;
                            const tempCtx = tempCanvas.getContext('2d');

                            tempCtx.drawImage(canvas, 0, sourceImgSliceY, imgProps.width, sourceImgSliceHeight, 0, 0, imgProps.width, sourceImgSliceHeight);

                            const pageImgData = tempCanvas.toDataURL('image/png');
                            // Calculate the height this slice will take on the PDF page
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
                        printableElement.setAttribute('style', originalPrintableStyle); // Restore style
                    }
                }, 350);
            }, 500);
        });
    }

    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');

        const tableData = saveSelectionState();
        const originalBodyClassName = document.body.className;

        prepareForExport();

        setTimeout(() => {
            document.body.classList.add('print-mode');
            // Multiple reflow attempts
            document.body.offsetHeight;
            const table = document.getElementById('xsheet-table');
            if (table) table.offsetHeight;
            const printableArea = document.getElementById('printable-area');
            if (printableArea) printableArea.offsetHeight;

            // Use requestAnimationFrame to wait for the browser's next paint
            requestAnimationFrame(() => {
                recalculateDrawingLayerPosition();

                // Another small delay for good measure before print dialog
                setTimeout(() => {
                    window.print();
                }, 100); // Increased slightly
            });


            const cleanup = () => {
                document.body.classList.remove('print-mode');
                document.body.className = originalBodyClassName;
                cleanupAfterPrint(tableData);
                app.updateStatusMessage('Print job sent.');
                window.removeEventListener('afterprint', cleanup);
                document.removeEventListener('keyup', escapeListener);
                isPrinting = false;
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

        if (!table || !layerContainer.parentNode || !printableArea) {
            console.warn("RecalculateDrawingLayerPosition: Missing elements.", { table, layerContainerParent: layerContainer.parentNode, printableArea });
            return;
        }

        // Ensure drawing layer is a child of printableArea for correct offset calculation
        if (layerContainer.parentNode !== printableArea) {
            printableArea.appendChild(layerContainer);
            // Force a reflow after DOM change
            printableArea.offsetHeight;
        }

        // Get offsetTop/Left relative to printableArea
        // This assumes table is a direct child or nested in non-positioned elements within printableArea
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
                const body = document.getElementById('xsheet-body');
                const rowIndex = row && body ? Array.from(body.children).indexOf(row) : -1;
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
        const tableBodyForContent = document.getElementById('xsheet-body');
        if (tableBodyForContent) {
            allEditableCells.forEach(cell => {
                const row = cell.closest('tr');
                if (row && row.parentNode === tableBodyForContent) { // Ensure row is part of the main body
                    const rowIndex = Array.from(tableBodyForContent.children).indexOf(row);
                    const colIndex = Array.from(row.children).indexOf(cell);
                    tableData.cellContents.push({
                        rowIndex,
                        colIndex,
                        content: cell.innerHTML,
                        isModified: cell.classList.contains('modified')
                    });
                }
            });
        }

        return tableData;
    }

    function restoreSelectionState(tableData) {
        if (!tableData || !tableData.selectedIndices) return;

        if (app.clearCellSelection) app.clearCellSelection();

        const tableBody = document.getElementById('xsheet-body');
        if (!tableBody) return;

        tableData.selectedIndices.forEach(index => {
            if (index.rowIndex >= 0 && index.rowIndex < tableBody.children.length && tableBody.children[index.rowIndex]) {
                const row = tableBody.children[index.rowIndex];
                if (index.colIndex >= 0 && index.colIndex < row.children.length && row.children[index.colIndex]) {
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
                if (cellData.rowIndex >= 0 && cellData.rowIndex < tableBody.children.length) {
                    const row = tableBody.children[cellData.rowIndex];
                    if (row && cellData.colIndex >= 0 && cellData.colIndex < row.children.length) {
                        const cell = row.children[cellData.colIndex];
                        if (cell && !cell.classList.contains('waveform-col') && cell.contentEditable === 'true') {
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
            // This will re-calculate based on current screen view
            app.Drawing.state.layerSystem.updateLayoutSize();
        }
    }

    app.Export = {
        init
    };

    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);
/**
 * export.js - Export and printing functionality for Animation X-Sheet
 * Handles PDF export and printing with improved reliability
 */

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
        const savedData = app.collectData(); // Critical: Save state BEFORE any DOM manipulation
        const printableElement = document.getElementById('printable-area');
        const originalPrintableStyle = printableElement.getAttribute('style') || '';

        document.body.classList.add('print-mode');

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        prepareForExport();

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        recalculateDrawingLayerPosition(false, 'pdf');

        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    const canvas = await html2canvas(printableElement, {
                        scale: 1.5,
                        useCORS: true,
                        logging: false,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        scrollX: 0,
                        scrollY: 0,
                        windowWidth: document.documentElement.scrollWidth,
                        windowHeight: document.documentElement.scrollHeight
                    });

                    const imgData = canvas.toDataURL('image/png');
                    const { jsPDF } = window.jspdf;
                    const pdfWidth = 215.9, pdfHeight = 279.4, margin = 10;
                    const contentWidth = pdfWidth - (2 * margin);
                    const contentHeight = pdfHeight - (2 * margin);
                    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
                    const imgProps = pdf.getImageProperties(imgData);
                    const pixelsPerPdfPage = contentHeight * (imgProps.width / contentWidth);
                    const numPages = Math.ceil(imgProps.height / pixelsPerPdfPage);

                    for (let i = 0; i < numPages; i++) {
                        if (i > 0) pdf.addPage();
                        let sourceImgSliceY = i * pixelsPerPdfPage;
                        let sourceImgSliceHeight = Math.min(pixelsPerPdfPage, imgProps.height - sourceImgSliceY);
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
                    // Order of cleanup:
                    document.body.classList.remove('print-mode');
                    printableElement.setAttribute('style', originalPrintableStyle);
                    // 1. Restore data first (this might regenerate table, affecting dimensions)
                    if (app.restoreData && savedData) {
                        app.restoreData(savedData);
                    }
                    // 2. Then restore drawing layers, which will call updateLayoutSize based on restored table
                    restoreDrawingLayers();
                    app.updateStatusMessage("Export cleanup complete."); // Update status after all restore ops
                }
            }, 200);
        });
    }

    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');
        const tableData = saveSelectionState(); // Critical: Save state BEFORE any DOM manipulation
        const originalBodyClassName = document.body.className;

        document.body.classList.add('print-mode');

        requestAnimationFrame(() => {
            requestAnimationFrame(async () => {
                prepareForExport();
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                recalculateDrawingLayerPosition(true, 'print');
                setTimeout(() => {
                    window.print();
                }, 50);
            });
        });

        const cleanup = () => {
            document.body.classList.remove('print-mode');
            document.body.className = originalBodyClassName;
            // Order of cleanup:
            // 1. Restore specific tableData parts (metadata, cell content)
            if (tableData) {
                const tableBody = document.getElementById('xsheet-body');
                const waveformCells = document.querySelectorAll('.waveform-col');
                waveformCells.forEach(cell => {
                    const originalContent = cell.getAttribute('data-original-content');
                    if (originalContent !== null) {
                        cell.innerHTML = originalContent;
                        cell.removeAttribute('data-original-content');
                    }
                });
                if (tableData.cellContents && tableBody) {
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
                if (tableData.metadata) {
                    Object.keys(tableData.metadata).forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.value = tableData.metadata[id] || '';
                    });
                }
                restoreSelectionState(tableData);
            }
            // 2. Then restore drawing layers
            restoreDrawingLayers();
            document.body.offsetHeight;
            app.updateStatusMessage('Print job sent.');
            window.removeEventListener('afterprint', cleanup);
            document.removeEventListener('keyup', escapeListener);
            isPrinting = false;
        };
        const escapeListener = (e) => {
            if (e.key === "Escape") cleanup();
        };
        if (window.onafterprint !== undefined) {
            window.addEventListener('afterprint', cleanup, { once: true });
        } else {
            setTimeout(cleanup, 3000);
        }
        setTimeout(() => {
            document.addEventListener('keyup', escapeListener, { once: true });
        }, 200);
    }

    function prepareForExport() {
        if (app.Audio && app.Audio.state.audioBuffer && app.Audio.state.waveformData.length > 0) {
            app.Audio.drawWaveformInCells();
        }
        prepareDrawingLayersForExport();
    }

    function prepareDrawingLayersForExport() {
        // ... (this function remains the same as your last fully working version)
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

    function recalculateDrawingLayerPosition(isForPrint = false, context = 'screen') {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }
        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const table = layerContainer._tableRef || document.getElementById('xsheet-table');
        const printableArea = document.getElementById('printable-area');

        if (!table || !printableArea) {
            console.warn("RecalculateDrawingLayerPosition: Missing table or printableArea for context:", context);
            return;
        }
        // Ensure layerContainer is child of printableArea, should have been done in prepareDrawingLayersForExport
        if (layerContainer.parentNode !== printableArea) {
            printableArea.appendChild(layerContainer);
            // It's good practice to force a reflow after DOM manipulation if subsequent calculations depend on it.
            // However, getBoundingClientRect should give current values.
            // printableArea.offsetHeight; 
        }

        const tableRect = table.getBoundingClientRect();
        const printableAreaRect = printableArea.getBoundingClientRect();

        // Calculate position of table's top-left corner relative to printableArea's top-left corner
        let topPos = tableRect.top - printableAreaRect.top;
        let leftPos = tableRect.left - printableAreaRect.left;

        // Logging the calculated positions before any adjustments
        console.log(`[${context.toUpperCase()}] Initial Rects: TableTop: ${tableRect.top.toFixed(2)}, PrintableAreaTop: ${printableAreaRect.top.toFixed(2)}, Calc Top: ${topPos.toFixed(2)}, Calc Left: ${leftPos.toFixed(2)}`);
        console.log(`[${context.toUpperCase()}] Table width/height: ${tableRect.width.toFixed(2)} / ${tableRect.height.toFixed(2)}`);


        if (context === 'print') {
            // If drawing appears too HIGH by X pixels, ADD X to topPos to move it DOWN.
            // If drawing appears too LOW by X pixels, SUBTRACT X from topPos to move it UP.

            // SCREENSHOT ANALYSIS: Drawing layer in print is slightly too HIGH.
            // This means 'topPos' is too small. We need to INCREASE it.
            topPos += 9; // <<<<<<< ADJUST THIS VALUE (e.g., 2, 3, 4, 5)
            console.log(`[PRINT] Adjusted topPos: ${topPos.toFixed(2)} (shim applied)`);

        } else if (context === 'pdf') {
            // SCREENSHOT ANALYSIS: PDF Export seems okay now.
            // If PDF drawing was slightly too LOW (pushed down), SUBTRACT to move it UP.
            // topPos -= 1; // Example: if drawing was 1px too low in PDF
            // If PDF drawing was slightly too HIGH, ADD to move it DOWN.
            // topPos +=1 // Example: if drawing was 1px too high in PDF
            console.log(`[PDF] topPos (no shim currently): ${topPos.toFixed(2)}`);
        }

        layerContainer.style.position = 'absolute';
        layerContainer.style.top = topPos + 'px';
        layerContainer.style.left = leftPos + 'px';
        layerContainer.style.width = tableRect.width + 'px';
        layerContainer.style.height = tableRect.height + 'px';
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
                if (row && row.parentNode === tableBodyForContent) {
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

    function cleanupAfterExport(savedData) { // Modified order
        document.body.classList.remove('print-mode');
        // No specific printableElement style was set here that needs restoring.

        if (app.restoreData && savedData) {
            app.restoreData(savedData);
        }
        restoreDrawingLayers(); // Call AFTER app.restoreData
        app.updateStatusMessage("Export cleanup complete.");
    }

    function cleanupAfterPrint(tableData) { // Modified order
        // document.body.classList.remove('print-mode'); // Already done in the printSheet's cleanup scope
        // document.body.className = originalBodyClassName; // Also handled there

        // Restore specific tableData parts first
        if (tableData) {
            const tableBody = document.getElementById('xsheet-body');
            const waveformCells = document.querySelectorAll('.waveform-col');
            waveformCells.forEach(cell => {
                const originalContent = cell.getAttribute('data-original-content');
                if (originalContent !== null) {
                    cell.innerHTML = originalContent;
                    cell.removeAttribute('data-original-content');
                }
            });
            if (tableData.cellContents && tableBody) {
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
            if (tableData.metadata) {
                Object.keys(tableData.metadata).forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = tableData.metadata[id] || '';
                });
            }
            restoreSelectionState(tableData);
        }

        restoreDrawingLayers(); // Call AFTER specific data restoration
        document.body.offsetHeight;
        app.updateStatusMessage('Print operation finished.'); // Changed message slightly
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

    app.Export = { init };
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);
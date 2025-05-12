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
        const savedData = app.collectData();
        const printableElement = document.getElementById('printable-area');
        const originalPrintableStyle = printableElement.getAttribute('style') || '';

        document.body.classList.add('print-mode');
        // printableElement.style.width = '100%'; // Let CSS handle this via .print-mode
        // printableElement.style.maxWidth = 'none';


        prepareForExport();

        return new Promise((resolve, reject) => {
            // Ensuring .print-mode styles are applied and layout is stable
            requestAnimationFrame(() => { // Wait for next frame
                document.body.offsetHeight;
                if (printableElement) printableElement.offsetHeight;

                recalculateDrawingLayerPosition(false, 'pdf'); // Recalculate for PDF context

                setTimeout(async () => { // Timeout for html2canvas
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

                        const pdfWidth = 215.9;
                        const pdfHeight = 279.4;
                        const margin = 10;

                        const contentWidth = pdfWidth - (2 * margin);
                        const contentHeight = pdfHeight - (2 * margin);

                        const pdf = new jsPDF({
                            orientation: 'portrait',
                            unit: 'mm',
                            format: 'letter'
                        });

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
                        document.body.classList.remove('print-mode');
                        printableElement.setAttribute('style', originalPrintableStyle);
                        cleanupAfterExport(savedData);
                    }
                }, 400);
            }); // End requestAnimationFrame
        });
    }

    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');

        const tableData = saveSelectionState();
        const originalBodyClassName = document.body.className;

        prepareForExport();

        // Use requestAnimationFrame for more reliable layout stabilization before printing
        requestAnimationFrame(() => {
            document.body.classList.add('print-mode');
            document.body.offsetHeight;
            const table = document.getElementById('xsheet-table');
            if (table) table.offsetHeight;
            const printableArea = document.getElementById('printable-area');
            if (printableArea) printableArea.offsetHeight;

            requestAnimationFrame(() => { // Nested rAF for even more certainty
                recalculateDrawingLayerPosition(true, 'print'); // Pass true for isForPrint

                setTimeout(() => {
                    window.print();
                }, 150);
            });
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

    function recalculateDrawingLayerPosition(isForPrint = false, context = 'screen') {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }
        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const table = layerContainer._tableRef || document.getElementById('xsheet-table');
        const printableArea = document.getElementById('printable-area');

        if (!table || !layerContainer.parentNode || !printableArea) {
            console.warn("RecalculateDrawingLayerPosition: Missing elements for context:", context);
            return;
        }

        if (layerContainer.parentNode !== printableArea) {
            printableArea.appendChild(layerContainer);
            printableArea.offsetHeight; // Reflow after appending
        }

        // Use getBoundingClientRect for more reliable positioning relative to viewport,
        // then adjust to be relative to printableArea.
        const tableRect = table.getBoundingClientRect();
        const printableAreaRect = printableArea.getBoundingClientRect();

        let topPos = tableRect.top - printableAreaRect.top;
        let leftPos = tableRect.left - printableAreaRect.left;

        // Add scroll offsets of printableArea IF it's a scrollable container itself
        // For now, assuming printableArea itself is not the primary scroller, but its content (table) might be.
        // topPos += printableArea.scrollTop;
        // leftPos += printableArea.scrollLeft;

        if (context === 'print') {
            console.log(`Print Context - Table top: ${tableRect.top}, PrintableArea top: ${printableAreaRect.top}, Calculated topPos: ${topPos}`);
            // If print consistently shifts drawing UP by X pixels, add X to topPos
            // topPos += 3; // Example: if drawing appears 3px too high (needs to move down)
            // If print consistently shifts drawing DOWN by X pixels, subtract X from topPos
            // topPos -= 50; // Example: if drawing appears 50px too low (needs to move up) - for testing the large downward shift
        } else if (context === 'pdf') {
            console.log(`PDF Context - Table top: ${tableRect.top}, PrintableArea top: ${printableAreaRect.top}, Calculated topPos: ${topPos}`);
            // If PDF consistently shifts drawing UP by X pixels, add X to topPos
            // topPos += 2; // Example: if drawing appears 2px too high
        }


        layerContainer.style.position = 'absolute';
        layerContainer.style.top = topPos + 'px';
        layerContainer.style.left = leftPos + 'px';
        layerContainer.style.width = tableRect.width + 'px'; // Use rect.width for consistency
        layerContainer.style.height = tableRect.height + 'px'; // Use rect.height
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
            if (index.rowIndex >= 0 && index.rowIndex < tableBody.children.length) {
                const row = tableBody.children[index.rowIndex];
                if (row && index.colIndex >= 0 && index.colIndex < row.children.length) {
                    const cell = row.children[index.colIndex];
                    if (cell && cell.contentEditable === 'true') {
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
            app.Drawing.state.layerSystem.updateLayoutSize();
        }
    }

    app.Export = { init };
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);
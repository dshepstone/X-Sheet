

/**
 * export.js - Export and printing functionality for Animation X-Sheet
 * Handles PDF export and printing with improved reliability
 */

// Create namespace for the export module
window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Export = window.XSheetApp.Export || {};

(function (app) {
    'use strict';

    // Initialize export functionality
    function init() {
        document.addEventListener('xsheet-export-pdf', exportToPDF);
        document.addEventListener('xsheet-print', printSheet);
    }

    function recalculateDrawingLayerPosition() {
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
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

        // Force layout recalculation immediately before measurements
        document.body.offsetHeight;
        printableArea.offsetHeight;
        table.offsetHeight;
        layerContainer.offsetHeight;

        const tableRect = table.getBoundingClientRect();
        const printableRect = printableArea.getBoundingClientRect();

        // Position the layerContainer relative to the printableArea
        layerContainer.style.position = 'absolute';
        layerContainer.style.top = (tableRect.top - printableRect.top) + 'px';
        layerContainer.style.left = (tableRect.left - printableRect.left) + 'px';
        layerContainer.style.width = tableRect.width + 'px';
        layerContainer.style.height = tableRect.height + 'px';
        layerContainer.style.zIndex = '1000'; // Ensure it's on top
        layerContainer.style.backgroundColor = 'transparent';
        layerContainer.style.opacity = '1';
        layerContainer.style.display = 'block'; // Ensure it's visible

        // Resize the actual canvas elements within layerContainer
        // and set their CSS background to transparent.
        layerSystem.layers.forEach(layer => {
            const canvas = layer.canvas;
            canvas.style.backgroundColor = 'transparent'; // CSS style for display
            // Set physical dimensions of the canvas drawing surface
            canvas.width = tableRect.width;
            canvas.height = tableRect.height;
        });

        // Redraw all objects onto the resized canvases
        layerSystem.redrawAll();

        console.log('Drawing layer repositioned and redrawn for print mode. Top:', layerContainer.style.top, 'Left:', layerContainer.style.left, 'W:', layerContainer.style.width, 'H:', layerContainer.style.height);
    }

    function prepareDrawingLayersForExport() {
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            console.warn('Drawing system not available for export preparation.');
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        // Save original CSS, DOM parent, and canvas dimensions
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

        layerContainer.style.display = 'block'; // Make visible for capture

        const printableArea = document.getElementById('printable-area');
        if (printableArea) {
            printableArea.appendChild(layerContainer); // Move into printable area
        } else {
            console.error("Printable area not found for moving drawing layer.");
            return;
        }
        console.log('Drawing layers prepared for export (moved to printable-area).');
    }

    function restoreDrawingLayers() {
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        if (layerContainer._originalParent) {
            layerContainer.style.display = layerContainer._originalDisplay;
            layerContainer.style.position = layerContainer._originalPos;
            layerContainer.style.top = layerContainer._originalTop;
            layerContainer.style.left = layerContainer._originalLeft;
            layerContainer.style.zIndex = layerContainer._originalZIndex;
            layerContainer.style.width = layerContainer._originalWidth;
            layerContainer.style.height = layerContainer._originalHeight;

            layerSystem.layers.forEach(layer => {
                if (layer.canvas._originalWidth !== undefined) {
                    layer.canvas.width = layer.canvas._originalWidth;
                    layer.canvas.height = layer.canvas._originalHeight;
                    delete layer.canvas._originalWidth;
                    delete layer.canvas._originalHeight;
                }
            });
            
            // Move back to original parent *before* redrawing with original dimensions
            layerContainer._originalParent.appendChild(layerContainer);
            layerSystem.redrawAll(); // Redraw with original dimensions in original location

            delete layerContainer._originalDisplay;
            delete layerContainer._originalPos;
            delete layerContainer._originalTop;
            delete layerContainer._originalLeft;
            delete layerContainer._originalZIndex;
            delete layerContainer._originalWidth;
            delete layerContainer._originalHeight;
            delete layerContainer._originalParent;
            console.log('Drawing layers restored to original state.');
        }
    }

    function hideUIControls() {
        const elements = [
            document.querySelector('.controls'),
            document.querySelector('#audio-controls'),
            document.querySelector('.status'),
            document.querySelector('#phonetic-input'),
            document.querySelector('.drawing-toolbar'),
            document.querySelector('#drawing-toolbar-container')
        ];
        elements.forEach(element => {
            if (element) element.style.display = 'none';
        });
    }

    function showUIControls() {
        const elements = [
            { el: document.querySelector('.controls'), display: 'flex' },
            { el: document.querySelector('#audio-controls'), display: 'flex' },
            { el: document.querySelector('.status'), display: 'block' },
            { el: document.querySelector('.drawing-toolbar'), display: 'flex' },
            { el: document.querySelector('#drawing-toolbar-container'), display: 'block' } // or 'flex' if it's a flex container
        ];
        elements.forEach(item => {
            if (item.el) item.el.style.display = item.display;
        });
    }
    
    function saveSelectionState() {
        const selectedCells = document.querySelectorAll('.selected-cell');
        const tableData = {
            selectedIndices: Array.from(selectedCells).map(cell => {
                const row = cell.closest('tr');
                const rowIndex = Array.from(document.getElementById('xsheet-body').children).indexOf(row);
                const colIndex = Array.from(row.children).indexOf(cell);
                return { rowIndex, colIndex };
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

        document.querySelectorAll('.waveform-col').forEach(cell => {
            cell.setAttribute('data-original-content', cell.innerHTML);
        });

        document.querySelectorAll('#xsheet-body [contenteditable="true"]').forEach(cell => {
            const row = cell.closest('tr');
            if (row) {
                const rowIndex = Array.from(document.getElementById('xsheet-body').children).indexOf(row);
                const colIndex = Array.from(row.children).indexOf(cell);
                tableData.cellContents.push({
                    rowIndex, colIndex, content: cell.innerHTML,
                    isModified: cell.classList.contains('modified')
                });
            }
        });
        return tableData;
    }

    function restoreSelectionState(tableData) {
        if (!tableData || !tableData.selectedIndices) return;
        app.clearCellSelection(); // From core.js
        const tableBody = document.getElementById('xsheet-body');
        tableData.selectedIndices.forEach(index => {
            if (index.rowIndex >= 0 && index.rowIndex < tableBody.children.length) {
                const row = tableBody.children[index.rowIndex];
                if (index.colIndex >= 0 && index.colIndex < row.children.length) {
                    const cell = row.children[index.colIndex];
                    if (cell.contentEditable === 'true') {
                        cell.classList.add('selected-cell');
                        if (app.state && app.state.selectedCells && !app.state.selectedCells.includes(cell)) {
                           app.state.selectedCells.push(cell);
                        }
                    }
                }
            }
        });
    }
    
    function cleanupAfterExport(savedData) {
        showUIControls();
        restoreDrawingLayers(); // This also redraws layers with original dimensions
        if (app.restoreData) app.restoreData(savedData); // From core.js
        // Waveform cells are handled by app.restoreData if it redraws the table, or might need specific handling
        document.querySelectorAll('.waveform-col').forEach(cell => {
             const originalContent = cell.getAttribute('data-original-content');
             if (originalContent !== null) {
                 cell.innerHTML = originalContent;
                 cell.removeAttribute('data-original-content');
             }
        });
    }

    function cleanupAfterPrint(tableData, originalBodyStyle) {
        showUIControls();
        const originalWf = document.querySelector('.waveform-container');
        if (originalWf) originalWf.style.display = '';
        
        restoreDrawingLayers();

        document.querySelectorAll('.waveform-col').forEach(cell => {
            const originalContent = cell.getAttribute('data-original-content');
            if (originalContent !== null) {
                cell.innerHTML = originalContent;
                cell.removeAttribute('data-original-content');
            }
        });

        if (tableData && tableData.cellContents) {
            const tableBody = document.getElementById('xsheet-body');
            tableData.cellContents.forEach(cellData => {
                if (cellData.rowIndex >= 0 && cellData.rowIndex < tableBody.children.length) {
                    const row = tableBody.children[cellData.rowIndex];
                    if (cellData.colIndex >= 0 && cellData.colIndex < row.children.length) {
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

    function exportToPDF() {
        const savedData = app.collectData ? app.collectData() : {}; // Save current project state
        app.updateStatusMessage('Preparing PDF. Please wait...');

        prepareDrawingLayersForExport(); // Save originals, move layer container
        if (app.Audio && app.Audio.drawWaveformInCells) app.Audio.drawWaveformInCells();
        hideUIControls();

        document.body.classList.add('print-mode');
        document.body.offsetHeight; // Force reflow for print-mode styles

        const observer = new MutationObserver((mutations, obs) => {
            obs.disconnect();

            document.body.offsetHeight; // Reflow again before measurements
            recalculateDrawingLayerPosition(); // Reposition/resize drawing layer and canvases, then redraw objects

            setTimeout(() => { // Delay for rendering to complete before html2canvas
                try {
                    html2canvas(document.getElementById('printable-area'), {
                        scale: 1.5, useCORS: true, logging: false, allowTaint: true, backgroundColor: '#ffffff'
                    }).then(canvas => {
                        const imgData = canvas.toDataURL('image/png');
                        let pdfWidth = app.state.currentTemplate === 'large' ? 279.4 : 215.9;
                        let pdfHeight = app.state.currentTemplate === 'large' ? 431.8 : 279.4;
                        const { jsPDF } = window.jspdf;
                        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfWidth, pdfHeight] });
                        const imgProps = pdf.getImageProperties(imgData);
                        const pdfPageWidth = pdf.internal.pageSize.getWidth() - 20; // margins 10mm each side
                        const pdfPageHeight = pdf.internal.pageSize.getHeight() - 20; // margins 10mm each side
                        const ratio = Math.min(pdfPageWidth / imgProps.width, pdfPageHeight / imgProps.height);
                        const imgWidth = imgProps.width * ratio;
                        const imgHeight = imgProps.height * ratio;

                        pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
                        pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                    }).catch(err => {
                        console.error('HTML2Canvas error:', err);
                        app.updateStatusMessage('Error creating PDF: ' + err.message);
                    }).finally(() => {
                        document.body.classList.remove('print-mode');
                        cleanupAfterExport(savedData);
                    });
                } catch (e) {
                    console.error('Error exporting PDF:', e);
                    app.updateStatusMessage('Error exporting PDF: ' + e.message);
                    document.body.classList.remove('print-mode');
                    cleanupAfterExport(savedData);
                }
            }, 250); // Increased delay for complex rendering
        });

        observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style'] });
         // Fallback if observer doesn't fire (e.g. no style changes)
        setTimeout(() => {
            if(document.body.classList.contains('print-mode') && observer){ // if observer is still attached
                console.warn("PDF export MutationObserver fallback triggered.");
                observer.disconnect(); // prevent it from firing later
                 document.body.offsetHeight; 
                 recalculateDrawingLayerPosition();
                 setTimeout(() => { /* ... same html2canvas logic ... */ 
                    try {
                        html2canvas(document.getElementById('printable-area'), {
                            scale: 1.5, useCORS: true, logging: false, allowTaint: true, backgroundColor: '#ffffff'
                        }).then(canvas => {
                            const imgData = canvas.toDataURL('image/png');
                            let pdfWidth = app.state.currentTemplate === 'large' ? 279.4 : 215.9;
                            let pdfHeight = app.state.currentTemplate === 'large' ? 431.8 : 279.4;
                            const { jsPDF } = window.jspdf;
                            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfWidth, pdfHeight] });
                            const imgProps = pdf.getImageProperties(imgData);
                            const pdfPageWidth = pdf.internal.pageSize.getWidth() - 20;
                            const pdfPageHeight = pdf.internal.pageSize.getHeight() - 20;
                            const ratio = Math.min(pdfPageWidth / imgProps.width, pdfPageHeight / imgProps.height);
                            const imgWidth = imgProps.width * ratio;
                            const imgHeight = imgProps.height * ratio;
    
                            pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
                            pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                        }).catch(err => {
                            console.error('HTML2Canvas error (fallback):', err);
                            app.updateStatusMessage('Error creating PDF (fallback): ' + err.message);
                        }).finally(() => {
                            document.body.classList.remove('print-mode');
                            cleanupAfterExport(savedData);
                        });
                    } catch (e) {
                        console.error('Error exporting PDF (fallback):', e);
                        app.updateStatusMessage('Error exporting PDF (fallback): ' + e.message);
                        document.body.classList.remove('print-mode');
                        cleanupAfterExport(savedData);
                    }
                 }, 250);
            }
        }, 500); // Short fallback, as observer should ideally catch it quickly if styles apply.
    }

    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');
        const tableData = saveSelectionState();
        const originalBodyStyle = document.body.getAttribute('style') || '';

        prepareDrawingLayersForExport();
        if (app.Audio && app.Audio.drawWaveformInCells) app.Audio.drawWaveformInCells();
        hideUIControls();

        document.body.classList.add('print-mode');
        document.body.offsetHeight;

        let printFallbackTimeout;

        const observer = new MutationObserver((mutations, obs) => {
            obs.disconnect();
            clearTimeout(printFallbackTimeout); // Clear fallback if observer fires

            document.body.offsetHeight;
            recalculateDrawingLayerPosition();

            setTimeout(() => { // Delay for rendering
                window.print();
                // Cleanup is tricky here. window.print() is blocking.
                // Using a longer timeout for cleanup is a common approach.
                setTimeout(() => {
                    document.body.classList.remove('print-mode');
                    cleanupAfterPrint(tableData, originalBodyStyle);
                    app.updateStatusMessage('Print complete');
                }, 2000); // Allow time for print dialog and printing
            }, 250);
        });

        observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style'] });
        
        printFallbackTimeout = setTimeout(() => {
             if(document.body.classList.contains('print-mode') && observer){
                console.warn("Print sheet MutationObserver fallback triggered.");
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
        }, 1000); // Fallback timeout for print
    }

    app.Export = { init, exportToPDF, printSheet };
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);


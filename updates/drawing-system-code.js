function initDrawingSystem() {
    // Wait for the X-Sheet to be fully initialized
    document.addEventListener('DOMContentLoaded', function() {
        // Setup after a brief delay to ensure table is rendered
        setTimeout(() => {
            // Get the X-Sheet table element
            const xsheetTable = document.getElementById('xsheet-table');
            if (!xsheetTable) {
                console.error('X-Sheet table not found');
                return;
            }

            // Create drawing systems
            const drawingLayerSystem = new DrawingLayerSystem(xsheetTable);
            const drawingToolSystem = new DrawingToolSystem(drawingLayerSystem);

            // Store global reference
            window.xsheetDrawing = {
                layerSystem: drawingLayerSystem,
                toolSystem: drawingToolSystem
            };

            // Add to status message
            const statusElement = document.getElementById('status-message');
            if (statusElement) {
                statusElement.textContent = 'Drawing tools initialized';
            }

            // Integrate with X-Sheet save/load system
            integrateWithXSheetSaveLoad();

            // Integrate with X-Sheet PDF and printing
            integrateWithXSheetExport();

            // Custom event for when drawing objects change
            document.addEventListener('xsheet-redraw', function() {
                drawingLayerSystem.redrawAll();
            });

            console.log('Drawing tools initialized successfully');
        }, 500);
    });
}

// Integrate drawing data with X-Sheet save/load system
function integrateWithXSheetSaveLoad() {
    // Store original functions
    const originalCollectData = window.collectData;
    const originalRestoreData = window.restoreData;

    // Override collectData to include drawings
    window.collectData = function() {
        // Call original function to get base data
        const data = originalCollectData ? originalCollectData() : {};

        // Add drawing data if drawing system is initialized
        if (window.xsheetDrawing && window.xsheetDrawing.layerSystem) {
            data.drawingLayers = [];

            // Collect objects from each layer
            window.xsheetDrawing.layerSystem.layers.forEach(layer => {
                const layerData = {
                    name: layer.name,
                    visible: layer.visible,
                    objects: layer.objects.map(obj => obj.toJSON())
                };

                data.drawingLayers.push(layerData);
            });
        }

        return data;
    };

    // Override restoreData to handle drawings
    window.restoreData = function(data) {
        // Call original function to restore base data
        if (originalRestoreData) {
            originalRestoreData(data);
        }

        // Restore drawing data if available
        if (data.drawingLayers && window.xsheetDrawing && window.xsheetDrawing.layerSystem) {
            const layerSystem = window.xsheetDrawing.layerSystem;

            // Clear existing layers
            layerSystem.clearAllLayers();

            // Restore each layer
            data.drawingLayers.forEach((layerData, index) => {
                // Create layer if needed
                if (index >= layerSystem.layers.length) {
                    layerSystem.addLayer(layerData.name);
                } else {
                    layerSystem.layers[index].name = layerData.name;
                    layerSystem.layers[index].visible = layerData.visible;
                }

                // Restore objects
                layerData.objects.forEach(objData => {
                    const newObj = DrawingObjectFactory.createFromJSON(objData);
                    if (newObj) {
                        layerSystem.layers[index].objects.push(newObj);
                    }
                });
            });

            // Redraw
            layerSystem.redrawAll();
        }
    };
}

// Integrate drawing layers with PDF export and printing
function integrateWithXSheetExport() {
    // Store original functions
    const originalExportToPDF = window.exportToPDF;
    const originalPrintSheet = window.printSheet;

    // Override PDF export to include drawings
    window.exportToPDF = function() {
        // If no drawing system, use original function
        if (!window.xsheetDrawing || !window.xsheetDrawing.layerSystem) {
            return originalExportToPDF ? originalExportToPDF() : null;
        }

        // Save current state
        const savedDrawingState = window.collectData().drawingLayers;

        // Make sure the drawing layer container is visible for capture
        const layerContainer = window.xsheetDrawing.layerSystem.container;
        const originalDisplay = layerContainer.style.display;
        layerContainer.style.display = 'block';

        // Call original PDF export function
        const result = originalExportToPDF ? originalExportToPDF() : null;

        // Restore container visibility
        layerContainer.style.display = originalDisplay;

        return result;
    };

    // Override print function to include drawings
    window.printSheet = function() {
        // If no drawing system, use original function
        if (!window.xsheetDrawing || !window.xsheetDrawing.layerSystem) {
            return originalPrintSheet ? originalPrintSheet() : null;
        }

        // Save current state
        const savedDrawingState = window.collectData().drawingLayers;

        // Make sure the drawing layer container is visible for printing
        const layerContainer = window.xsheetDrawing.layerSystem.container;
        const originalDisplay = layerContainer.style.display;
        layerContainer.style.display = 'block';

        // Add print-specific styles for drawing layers
        const styleTag = document.createElement('style');
        styleTag.id = 'drawing-print-styles';
        styleTag.textContent = `
        @media print {
            .drawing-layer-container {
                display: block !important;
                position: absolute !important;
                z-index: 1000 !important;
            }

            .drawing-layer-container canvas {
                position: absolute !important;
            }

            .drawing-toolbar {
                display: none !important;
            }
        }
        `;
        document.head.appendChild(styleTag);

        // Call original print function
        const result = originalPrintSheet ? originalPrintSheet() : null;

        // Clean up
        if (styleTag.parentNode) {
            styleTag.parentNode.removeChild(styleTag);
        }

        // Restore container visibility
        layerContainer.style.display = originalDisplay;

        return result;
    };
}

// Add event listener for xsheet-updated custom event
function setupXSheetUpdateHandling() {
    // Hook into existing update functions
    if (typeof window.generateTable === 'function') {
        const originalGenerateTable = window.generateTable;
        window.generateTable = function() {
            // Call original function
            const result = originalGenerateTable.apply(this, arguments);

            // Fire update event
            document.dispatchEvent(new Event('xsheet-updated'));

            return result;
        };
    }

    if (typeof window.addEightRows === 'function') {
        const originalAddEightRows = window.addEightRows;
        window.addEightRows = function() {
            // Call original function
            const result = originalAddEightRows.apply(this, arguments);

            // Fire update event
            document.dispatchEvent(new Event('xsheet-updated'));

            return result;
        };
    }

    if (typeof window.updateTemplate === 'function') {
        const originalUpdateTemplate = window.updateTemplate;
        window.updateTemplate = function() {
            // Call original function
            const result = originalUpdateTemplate.apply(this, arguments);

            // Fire update event
            document.dispatchEvent(new Event('xsheet-updated'));

            return result;
        };
    }
}

// Initialize everything when included in the X-Sheet HTML
initDrawingSystem();
setupXSheetUpdateHandling();

/**
 * INTERACTIVE X-SHEET DRAWING TOOLS IMPLEMENTATION
 * 
 * This code adds comprehensive drawing capabilities to the animation X-Sheet.
 * Features include:
 * - Multiple drawing layers
 * - Various drawing tools (pen, line, arrows, shapes, text, images, animation symbols)
 * - Grid-aware annotation that can span multiple frames
 * - Object selection and manipulation
 * - Integration with saving, loading, and printing
 * 
 * To implement, add this code to the interactive-xsheet HTML file and call initDrawingSystem()
 * during document initialization.
 */

/**
 * DRAWING LAYER SYSTEM
 * Manages the canvas layers that contain drawing objects
 */
class DrawingLayerSystem {
    constructor(xsheetTable) {
        this.xsheetTable = xsheetTable;
        this.layers = [];
        this.activeLayerIndex = 0;
        this.container = null;
        
        this.init();
    }
    
    init() {
        // Create container aligned with table
        const tableRect = this.xsheetTable.getBoundingClientRect();
        this.container = document.createElement('div');
        this.container.className = 'drawing-layer-container';
        this.container.style.position = 'absolute';
        this.container.style.left = `${tableRect.left}px`;
        this.container.style.top = `${tableRect.top}px`;
        this.container.style.width = `${tableRect.width}px`;
        this.container.style.height = `${tableRect.height}px`;
        this.container.style.pointerEvents = 'none'; // Initially pass events through
        this.container.style.zIndex = '50';
        document.body.appendChild(this.container);
        
        // Create default background and foreground layers
        this.addLayer('background');
        this.addLayer('foreground');
        this.setActiveLayer(1); // Set foreground as active by default
        
        // Handle window resize and table changes
        this.setupResizeHandling();
    }
    
    addLayer(name) {
        const canvas = document.createElement('canvas');
        canvas.className = `drawing-layer-${name}`;
        canvas.width = this.container.clientWidth;
        canvas.height = this.container.clientHeight;
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.pointerEvents = 'none';
        
        this.container.appendChild(canvas);
        
        const layer = {
            name: name,
            canvas: canvas,
            context: canvas.getContext('2d'),
            objects: [],
            visible: true
        };
        
        this.layers.push(layer);
        return this.layers.length - 1; // Return index of new layer
    }
    
    setActiveLayer(index) {
        if (index >= 0 && index < this.layers.length) {
            this.activeLayerIndex = index;
            return true;
        }
        return false;
    }
    
    getActiveLayer() {
        return this.layers[this.activeLayerIndex];
    }
    
    setupResizeHandling() {
        // Update canvas position and size when window resizes
        window.addEventListener('resize', () => this.updateLayoutSize());
        
        // Custom event for when X-Sheet table changes
        document.addEventListener('xsheet-updated', () => this.updateLayoutSize());
    }
    
    updateLayoutSize() {
        const tableRect = this.xsheetTable.getBoundingClientRect();
        
        // Store current drawings from each layer
        const tempCanvases = this.layers.map(layer => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = layer.canvas.width;
            tempCanvas.height = layer.canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(layer.canvas, 0, 0);
            return tempCanvas;
        });
        
        // Update container position and dimensions
        this.container.style.left = `${tableRect.left}px`;
        this.container.style.top = `${tableRect.top}px`;
        this.container.style.width = `${tableRect.width}px`;
        this.container.style.height = `${tableRect.height}px`;
        
        // Update each layer canvas
        this.layers.forEach((layer, i) => {
            const scaleX = tableRect.width / layer.canvas.width;
            const scaleY = tableRect.height / layer.canvas.height;
            
            layer.canvas.width = tableRect.width;
            layer.canvas.height = tableRect.height;
            
            // Redraw with scaling
            layer.context.save();
            layer.context.scale(scaleX, scaleY);
            layer.context.drawImage(tempCanvases[i], 0, 0);
            layer.context.restore();
        });
        
        // Force redraw of all objects
        this.redrawAll();
    }
    
    enableDrawing() {
        this.layers.forEach(layer => {
            layer.canvas.style.pointerEvents = 'auto';
        });
    }
    
    disableDrawing() {
        this.layers.forEach(layer => {
            layer.canvas.style.pointerEvents = 'none';
        });
    }
    
    clearLayer(layerIndex) {
        if (layerIndex >= 0 && layerIndex < this.layers.length) {
            const layer = this.layers[layerIndex];
            layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            layer.objects = [];
        }
    }
    
    clearAllLayers() {
        this.layers.forEach((layer, index) => {
            this.clearLayer(index);
        });
    }
    
    // Convert screen coordinates to canvas coordinates
    screenToCanvas(screenX, screenY) {
        const containerRect = this.container.getBoundingClientRect();
        return {
            x: screenX - containerRect.left,
            y: screenY - containerRect.top
        };
    }
    
    // Convert frame/column to canvas coordinates (for multi-frame spanning)
    gridToCanvas(frame, column) {
        const cell = document.querySelector(`tr.frame-${frame} td:nth-child(${column})`);
        if (!cell) return null;
        
        const cellRect = cell.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        
        return {
            x: cellRect.left - containerRect.left + cellRect.width / 2,
            y: cellRect.top - containerRect.top + cellRect.height / 2
        };
    }
    
    // Add a drawing object to the active layer
    addObject(object) {
        const layer = this.getActiveLayer();
        layer.objects.push(object);
        this.redrawLayer(this.activeLayerIndex);
        return object;
    }
    
    // Redraw a specific layer
    redrawLayer(layerIndex) {
        if (layerIndex >= 0 && layerIndex < this.layers.length) {
            const layer = this.layers[layerIndex];
            layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            
            // Draw all objects in this layer
            layer.objects.forEach(obj => {
                if (obj.visible) {
                    obj.draw(layer.context);
                }
            });
        }
    }
    
    // Redraw all layers
    redrawAll() {
        this.layers.forEach((_, index) => {
            this.redrawLayer(index);
        });
    }
    
    // Find object under point
    findObjectAt(x, y) {
        // Check active layer first, then others in reverse order (top to bottom)
        const activeLayer = this.getActiveLayer();
        
        // Check active layer
        for (let i = activeLayer.objects.length - 1; i >= 0; i--) {
            const obj = activeLayer.objects[i];
            if (obj.containsPoint(x, y)) {
                return { object: obj, layerIndex: this.activeLayerIndex };
            }
        }
        
        // Check other layers from top to bottom
        for (let l = this.layers.length - 1; l >= 0; l--) {
            if (l === this.activeLayerIndex) continue; // Skip active layer (already checked)
            
            const layer = this.layers[l];
            if (!layer.visible) continue;
            
            for (let i = layer.objects.length - 1; i >= 0; i--) {
                const obj = layer.objects[i];
                if (obj.containsPoint(x, y)) {
                    return { object: obj, layerIndex: l };
                }
            }
        }
        
        return null;
    }
    
    // Remove object
    removeObject(object, layerIndex) {
        const layer = layerIndex !== undefined ? this.layers[layerIndex] : this.getActiveLayer();
        const index = layer.objects.indexOf(object);
        if (index !== -1) {
            layer.objects.splice(index, 1);
            this.redrawLayer(layerIndex !== undefined ? layerIndex : this.activeLayerIndex);
            return true;
        }
        return false;
    }
}

/**
 * DRAWING OBJECT MODEL
 * Defines the object classes for different types of drawings
 */

// Base class for all drawing objects
class DrawingObject {
    constructor(props = {}) {
        this.x = props.x || 0;
        this.y = props.y || 0;
        this.color = props.color || '#000000';
        this.lineWidth = props.lineWidth || 2;
        this.visible = props.visible !== undefined ? props.visible : true;
        this.selected = false;
        this.type = 'drawingObject'; // Base type
    }
    
    draw(context) {
        // Base drawing functionality
        if (this.selected) {
            this.drawSelectionMarkers(context);
        }
    }
    
    drawSelectionMarkers(context) {
        // Draw selection handles (default implementation)
        context.save();
        context.strokeStyle = '#0099ff';
        context.lineWidth = 1;
        context.setLineDash([5, 3]);
        
        // Default is to draw a box around the object
        // This should be overridden by subclasses with specific bounds
        const bounds = this.getBounds();
        context.strokeRect(
            bounds.x - 2,
            bounds.y - 2,
            bounds.width + 4,
            bounds.height + 4
        );
        
        context.restore();
    }
    
    getBounds() {
        // Default implementation - should be overridden
        return { x: this.x, y: this.y, width: 0, height: 0 };
    }
    
    containsPoint(x, y) {
        // Default implementation - should be overridden
        return false;
    }
    
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }
    
    toJSON() {
        return {
            type: this.type,
            x: this.x,
            y: this.y,
            color: this.color,
            lineWidth: this.lineWidth,
            visible: this.visible
        };
    }
    
    static fromJSON(data) {
        // Factory method to create objects from JSON
        // This will be overridden by subclasses
        return new DrawingObject(data);
    }
}

// Line object
class LineObject extends DrawingObject {
    constructor(props = {}) {
        super(props);
        this.x2 = props.x2 || 0;
        this.y2 = props.y2 || 0;
        this.type = 'line';
        this.dashPattern = props.dashPattern || [];
    }
    
    draw(context) {
        context.save();
        context.beginPath();
        context.strokeStyle = this.color;
        context.lineWidth = this.lineWidth;
        
        if (this.dashPattern.length > 0) {
            context.setLineDash(this.dashPattern);
        }
        
        context.moveTo(this.x, this.y);
        context.lineTo(this.x2, this.y2);
        context.stroke();
        context.restore();
        
        super.draw(context);
    }
    
    getBounds() {
        const minX = Math.min(this.x, this.x2);
        const minY = Math.min(this.y, this.y2);
        const width = Math.abs(this.x2 - this.x);
        const height = Math.abs(this.y2 - this.y);
        
        return { x: minX, y: minY, width, height };
    }
    
    containsPoint(x, y) {
        // Check if point is near the line
        const lineLength = Math.sqrt(
            Math.pow(this.x2 - this.x, 2) + Math.pow(this.y2 - this.y, 2)
        );
        
        // If line is too short, use a minimum distance
        if (lineLength < 1) {
            const dx = x - this.x;
            const dy = y - this.y;
            return Math.sqrt(dx * dx + dy * dy) <= 5;
        }
        
        // Calculate distance from point to line segment
        const t = ((x - this.x) * (this.x2 - this.x) + (y - this.y) * (this.y2 - this.y)) / (lineLength * lineLength);
        
        if (t < 0) {
            // Point is beyond start point
            const dx = x - this.x;
            const dy = y - this.y;
            return Math.sqrt(dx * dx + dy * dy) <= 5;
        }
        
        if (t > 1) {
            // Point is beyond end point
            const dx = x - this.x2;
            const dy = y - this.y2;
            return Math.sqrt(dx * dx + dy * dy) <= 5;
        }
        
        // Calculate perpendicular distance
        const px = this.x + t * (this.x2 - this.x);
        const py = this.y + t * (this.y2 - this.y);
        const dx = x - px;
        const dy = y - py;
        
        return Math.sqrt(dx * dx + dy * dy) <= 5;
    }
    
    move(dx, dy) {
        super.move(dx, dy);
        this.x2 += dx;
        this.y2 += dy;
    }
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            x2: this.x2,
            y2: this.y2,
            dashPattern: this.dashPattern
        };
    }
    
    static fromJSON(data) {
        return new LineObject(data);
    }
}

// Arrow object (extends Line)
class ArrowObject extends LineObject {
    constructor(props = {}) {
        super(props);
        this.arrowSize = props.arrowSize || 10;
        this.type = 'arrow';
    }
    
    draw(context) {
        // Draw the line part
        super.draw(context);
        
        // Draw the arrowhead
        const angle = Math.atan2(this.y2 - this.y, this.x2 - this.x);
        
        context.save();
        context.fillStyle = this.color;
        context.beginPath();
        context.moveTo(this.x2, this.y2);
        context.lineTo(
            this.x2 - this.arrowSize * Math.cos(angle - Math.PI/6),
            this.y2 - this.arrowSize * Math.sin(angle - Math.PI/6)
        );
        context.lineTo(
            this.x2 - this.arrowSize * Math.cos(angle + Math.PI/6),
            this.y2 - this.arrowSize * Math.sin(angle + Math.PI/6)
        );
        context.closePath();
        context.fill();
        context.restore();
    }
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            arrowSize: this.arrowSize
        };
    }
    
    static fromJSON(data) {
        return new ArrowObject(data);
    }
}

// Rectangle object
class RectangleObject extends DrawingObject {
    constructor(props = {}) {
        super(props);
        this.width = props.width || 0;
        this.height = props.height || 0;
        this.fill = props.fill || false;
        this.fillColor = props.fillColor || this.color;
        this.type = 'rectangle';
    }
    
    draw(context) {
        context.save();
        context.strokeStyle = this.color;
        context.lineWidth = this.lineWidth;
        
        // Draw rectangle
        if (this.fill) {
            context.fillStyle = this.fillColor;
            context.fillRect(this.x, this.y, this.width, this.height);
        }
        
        context.strokeRect(this.x, this.y, this.width, this.height);
        context.restore();
        
        super.draw(context);
    }
    
    getBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }
    
    containsPoint(x, y) {
        // Check if point is inside or near the edge of the rectangle
        if (this.fill) {
            // For filled rectangles, check if point is inside
            return (
                x >= this.x && x <= this.x + this.width &&
                y >= this.y && y <= this.y + this.height
            );
        } else {
            // For unfilled rectangles, check if point is near the edges
            const nearLeft = Math.abs(x - this.x) <= 5;
            const nearRight = Math.abs(x - (this.x + this.width)) <= 5;
            const nearTop = Math.abs(y - this.y) <= 5;
            const nearBottom = Math.abs(y - (this.y + this.height)) <= 5;
            
            return (
                (nearLeft || nearRight) && (y >= this.y && y <= this.y + this.height) ||
                (nearTop || nearBottom) && (x >= this.x && x <= this.x + this.width)
            );
        }
    }
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            width: this.width,
            height: this.height,
            fill: this.fill,
            fillColor: this.fillColor
        };
    }
    
    static fromJSON(data) {
        return new RectangleObject(data);
    }
}

// Circle/Ellipse object
class EllipseObject extends DrawingObject {
    constructor(props = {}) {
        super(props);
        this.radiusX = props.radiusX || 0;
        this.radiusY = props.radiusY || 0;
        this.fill = props.fill || false;
        this.fillColor = props.fillColor || this.color;
        this.type = 'ellipse';
    }
    
    draw(context) {
        context.save();
        context.beginPath();
        context.strokeStyle = this.color;
        context.lineWidth = this.lineWidth;
        
        // Draw ellipse
        context.ellipse(
            this.x,
            this.y,
            this.radiusX,
            this.radiusY,
            0,
            0,
            2 * Math.PI
        );
        
        if (this.fill) {
            context.fillStyle = this.fillColor;
            context.fill();
        }
        
        context.stroke();
        context.restore();
        
        super.draw(context);
    }
    
    getBounds() {
        return {
            x: this.x - this.radiusX,
            y: this.y - this.radiusY,
            width: this.radiusX * 2,
            height: this.radiusY * 2
        };
    }
    
    containsPoint(x, y) {
        // Check if point is inside or near the edge of the ellipse
        const normalizedX = (x - this.x) / this.radiusX;
        const normalizedY = (y - this.y) / this.radiusY;
        const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
        
        if (this.fill) {
            // For filled ellipses, check if point is inside
            return distance <= 1.0;
        } else {
            // For unfilled ellipses, check if point is near the edge
            return Math.abs(distance - 1.0) <= 5 / this.radiusX;
        }
    }
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            radiusX: this.radiusX,
            radiusY: this.radiusY,
            fill: this.fill,
            fillColor: this.fillColor
        };
    }
    
    static fromJSON(data) {
        return new EllipseObject(data);
    }
}

// Text object
class TextObject extends DrawingObject {
    constructor(props = {}) {
        super(props);
        this.text = props.text || '';
        this.fontSize = props.fontSize || 14;
        this.fontFamily = props.fontFamily || 'Arial, sans-serif';
        this.align = props.align || 'left';
        this.type = 'text';
    }
    
    draw(context) {
        context.save();
        context.fillStyle = this.color;
        context.font = `${this.fontSize}px ${this.fontFamily}`;
        context.textAlign = this.align;
        
        // Draw text
        context.fillText(this.text, this.x, this.y);
        context.restore();
        
        super.draw(context);
    }
    
    getBounds() {
        // Estimate text dimensions
        const dummyCanvas = document.createElement('canvas');
        const ctx = dummyCanvas.getContext('2d');
        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        const metrics = ctx.measureText(this.text);
        
        const height = this.fontSize; // Approximation
        
        return {
            x: this.align === 'center' ? this.x - metrics.width / 2 :
               this.align === 'right' ? this.x - metrics.width : this.x,
            y: this.y - height,
            width: metrics.width,
            height: height
        };
    }
    
    containsPoint(x, y) {
        const bounds = this.getBounds();
        
        return (
            x >= bounds.x && x <= bounds.x + bounds.width &&
            y >= bounds.y && y <= bounds.y + bounds.height
        );
    }
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            text: this.text,
            fontSize: this.fontSize,
            fontFamily: this.fontFamily,
            align: this.align
        };
    }
    
    static fromJSON(data) {
        return new TextObject(data);
    }
}

// Image object
class ImageObject extends DrawingObject {
    constructor(props = {}) {
        super(props);
        this.width = props.width || 0;
        this.height = props.height || 0;
        this.imageUrl = props.imageUrl || '';
        this.image = null;
        this.loaded = false;
        this.type = 'image';
        
        // Load the image
        if (this.imageUrl) {
            this.loadImage(this.imageUrl);
        }
    }
    
    loadImage(url) {
        this.image = new Image();
        this.image.onload = () => {
            this.loaded = true;
            // If dimensions not specified, use image dimensions
            if (this.width === 0 || this.height === 0) {
                this.width = this.image.width;
                this.height = this.image.height;
            }
            // Trigger redraw
            document.dispatchEvent(new Event('xsheet-redraw'));
        };
        this.image.src = url;
    }
    
    draw(context) {
        if (this.loaded && this.image) {
            context.save();
            context.drawImage(this.image, this.x, this.y, this.width, this.height);
            context.restore();
        } else if (!this.loaded) {
            // Draw placeholder while loading
            context.save();
            context.strokeStyle = '#999999';
            context.lineWidth = 1;
            context.strokeRect(this.x, this.y, this.width, this.height);
            context.font = '10px Arial';
            context.fillStyle = '#999999';
            context.fillText('Loading Image...', this.x + 5, this.y + 15);
            context.restore();
        }
        
        super.draw(context);
    }
    
    getBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }
    
    containsPoint(x, y) {
        return (
            x >= this.x && x <= this.x + this.width &&
            y >= this.y && y <= this.y + this.height
        );
    }
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            width: this.width,
            height: this.height,
            imageUrl: this.imageUrl
        };
    }
    
    static fromJSON(data) {
        return new ImageObject(data);
    }
}

// Symbol object (predefined animation symbols)
class SymbolObject extends DrawingObject {
    constructor(props = {}) {
        super(props);
        this.symbolType = props.symbolType || 'default';
        this.scale = props.scale || 1.0;
        this.type = 'symbol';
    }
    
    draw(context) {
        context.save();
        context.strokeStyle = this.color;
        context.fillStyle = this.color;
        context.lineWidth = this.lineWidth;
        
        // Draw based on symbol type
        switch (this.symbolType) {
            case 'anticipation':
                this.drawAnticipation(context);
                break;
            case 'impact':
                this.drawImpact(context);
                break;
            case 'keyframe':
                this.drawKeyframe(context);
                break;
            case 'inbetween':
                this.drawInbetween(context);
                break;
            case 'hold':
                this.drawHold(context);
                break;
            default:
                this.drawDefault(context);
        }
        
        context.restore();
        
        super.draw(context);
    }
    
    drawAnticipation(context) {
        context.save();
        context.translate(this.x, this.y);
        context.scale(this.scale, this.scale);
        
        // Draw curved arrow going back
        context.beginPath();
        context.moveTo(0, 0);
        context.bezierCurveTo(-20, -5, -25, 10, -10, 15);
        context.stroke();
        
        // Draw arrowhead
        context.beginPath();
        context.moveTo(-10, 15);
        context.lineTo(-5, 10);
        context.lineTo(-15, 5);
        context.closePath();
        context.fill();
        
        context.restore();
    }
    
    drawImpact(context) {
        context.save();
        context.translate(this.x, this.y);
        context.scale(this.scale, this.scale);
        
        // Draw impact star
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const innerRadius = 5;
            const outerRadius = 15;
            
            context.beginPath();
            context.moveTo(
                innerRadius * Math.cos(angle),
                innerRadius * Math.sin(angle)
            );
            context.lineTo(
                outerRadius * Math.cos(angle),
                outerRadius * Math.sin(angle)
            );
            context.stroke();
        }
        
        context.restore();
    }
    
    drawKeyframe(context) {
        context.save();
        context.translate(this.x, this.y);
        context.scale(this.scale, this.scale);
        
        // Draw diamond
        context.beginPath();
        context.moveTo(0, -10);
        context.lineTo(10, 0);
        context.lineTo(0, 10);
        context.lineTo(-10, 0);
        context.closePath();
        context.stroke();
        context.fill();
        
        context.restore();
    }
    
    drawInbetween(context) {
        context.save();
        context.translate(this.x, this.y);
        context.scale(this.scale, this.scale);
        
        // Draw circle
        context.beginPath();
        context.arc(0, 0, 7, 0, Math.PI * 2);
        context.stroke();
        
        context.restore();
    }
    
    drawHold(context) {
        context.save();
        context.translate(this.x, this.y);
        context.scale(this.scale, this.scale);
        
        // Draw horizontal bar
        context.beginPath();
        context.moveTo(-15, 0);
        context.lineTo(15, 0);
        context.lineWidth = this.lineWidth * 2;
        context.stroke();
        
        context.restore();
    }
    
    drawDefault(context) {
        context.save();
        context.translate(this.x, this.y);
        context.scale(this.scale, this.scale);
        
        // Draw square
        context.beginPath();
        context.rect(-7, -7, 14, 14);
        context.stroke();
        
        context.restore();
    }
    
    getBounds() {
        // Approximate bounds based on symbol type
        const size = 20 * this.scale;
        return {
            x: this.x - size / 2,
            y: this.y - size / 2,
            width: size,
            height: size
        };
    }
    
    containsPoint(x, y) {
        const bounds = this.getBounds();
        const dx = x - this.x;
        const dy = y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Use a radius-based check as most symbols are roughly circular
        return distance <= bounds.width / 2;
    }
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            symbolType: this.symbolType,
            scale: this.scale
        };
    }
    
    static fromJSON(data) {
        return new SymbolObject(data);
    }
}

// Free-form path (for pen/brush tools)
class PathObject extends DrawingObject {
    constructor(props = {}) {
        super(props);
        this.points = props.points || [];
        this.smoothing = props.smoothing !== undefined ? props.smoothing : true;
        this.closed = props.closed || false;
        this.fill = props.fill || false;
        this.fillColor = props.fillColor || this.color;
        this.type = 'path';
    }
    
    addPoint(x, y) {
        this.points.push({x, y});
    }
    
    draw(context) {
        if (this.points.length < 2) return;
        
        context.save();
        context.beginPath();
        context.strokeStyle = this.color;
        context.lineWidth = this.lineWidth;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        
        // Start from first point
        context.moveTo(this.points[0].x, this.points[0].y);
        
        if (this.smoothing && this.points.length > 2) {
            // Draw using bezier curves for smoothing
            for (let i = 1; i < this.points.length - 1; i++) {
                const p1 = this.points[i];
                const p2 = this.points[i + 1];
                
                const xc = (p1.x + p2.x) / 2;
                const yc = (p1.y + p2.y) / 2;
                
                context.quadraticCurveTo(p1.x, p1.y, xc, yc);
            }
            
            // Connect to the last point
            const last = this.points[this.points.length - 1];
            context.lineTo(last.x, last.y);
        } else {
            // Simple line segments
            for (let i = 1; i < this.points.length; i++) {
                context.lineTo(this.points[i].x, this.points[i].y);
            }
        }
        
        if (this.closed) {
            context.closePath();
        }
        
        if (this.fill) {
            context.fillStyle = this.fillColor;
            context.fill();
        }
        
        context.stroke();
        context.restore();
        
        super.draw(context);
    }
    
    getBounds() {
        if (this.points.length === 0) {
            return { x: this.x, y: this.y, width: 0, height: 0 };
        }
        
        let minX = this.points[0].x;
        let maxX = this.points[0].x;
        let minY = this.points[0].y;
        let maxY = this.points[0].y;
        
        // Find min/max coordinates
        for (let i = 1; i < this.points.length; i++) {
            const point = this.points[i];
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }
    
    containsPoint(x, y) {
        if (this.points.length < 2) return false;
        
        // Check if point is near any line segment
        for (let i = 0; i < this.points.length - 1; i++) {
            const p1 = this.points[i];
            const p2 = this.points[i + 1];
            
            const lineLength = Math.sqrt(
                Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
            );
            
            // If line is too short, check distance to point
            if (lineLength < 1) {
                const dx = x - p1.x;
                const dy = y - p1.y;
                if (Math.sqrt(dx * dx + dy * dy) <= 5) {
                    return true;
                }
                continue;
            }
            
            // Calculate distance from point to line segment
            const t = ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / (lineLength * lineLength);
            
            if (t < 0) {
                // Point is beyond start point
                const dx = x - p1.x;
                const dy = y - p1.y;
                if (Math.sqrt(dx * dx + dy * dy) <= 5) {
                    return true;
                }
            } else if (t > 1) {
                // Point is beyond end point
                const dx = x - p2.x;
                const dy = y - p2.y;
                if (Math.sqrt(dx * dx + dy * dy) <= 5) {
                    return true;
                }
            } else {
                // Calculate perpendicular distance
                const px = p1.x + t * (p2.x - p1.x);
                const py = p1.y + t * (p2.y - p1.y);
                const dx = x - px;
                const dy = y - py;
                
                if (Math.sqrt(dx * dx + dy * dy) <= 5) {
                    return true;
                }
            }
        }
        
        // If closed and filled, also check if point is inside
        if (this.closed && this.fill) {
            // Use point-in-polygon algorithm
            let inside = false;
            for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
                const xi = this.points[i].x;
                const yi = this.points[i].y;
                const xj = this.points[j].x;
                const yj = this.points[j].y;
                
                const intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            
            return inside;
        }
        
        return false;
    }
    
    move(dx, dy) {
        super.move(dx, dy);
        
        // Move all points
        this.points.forEach(point => {
            point.x += dx;
            point.y += dy;
        });
    }
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            points: this.points,
            smoothing: this.smoothing,
            closed: this.closed,
            fill: this.fill,
            fillColor: this.fillColor
        };
    }
    
    static fromJSON(data) {
        return new PathObject(data);
    }
}

// Frame-Spanning Line (connects specific cells in the grid)
class FrameSpanningLineObject extends DrawingObject {
    constructor(props = {}) {
        super(props);
        this.startFrame = props.startFrame || 1;
        this.startColumn = props.startColumn || 1;
        this.endFrame = props.endFrame || 1;
        this.endColumn = props.endColumn || 1;
        this.type = 'frameSpanningLine';
        this.dashPattern = props.dashPattern || [];
        this.arrowStart = props.arrowStart || false;
        this.arrowEnd = props.arrowEnd || false;
        this.arrowSize = props.arrowSize || 10;
    }
    
    draw(context) {
        // Calculate actual coordinates from frame and column
        const layerSystem = window.xsheetDrawing.layerSystem;
        
        const startPos = layerSystem.gridToCanvas(this.startFrame, this.startColumn);
        const endPos = layerSystem.gridToCanvas(this.endFrame, this.endColumn);
        
        if (!startPos || !endPos) return; // Skip if cells not found
        
        context.save();
        context.beginPath();
        context.strokeStyle = this.color;
        context.lineWidth = this.lineWidth;
        
        if (this.dashPattern.length > 0) {
            context.setLineDash(this.dashPattern);
        }
        
        context.moveTo(startPos.x, startPos.y);
        context.lineTo(endPos.x, endPos.y);
        context.stroke();
        
        // Draw arrows if needed
        if (this.arrowStart) {
            this.drawArrow(context, endPos.x, endPos.y, startPos.x, startPos.y);
        }
        
        if (this.arrowEnd) {
            this.drawArrow(context, startPos.x, startPos.y, endPos.x, endPos.y);
        }
        
        context.restore();
        
        // Store computed coordinates for selection/hit testing
        this.computedStart = startPos;
        this.computedEnd = endPos;
        
        super.draw(context);
    }
    
    drawArrow(context, fromX, fromY, toX, toY) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        
        context.save();
        context.fillStyle = this.color;
        context.beginPath();
        context.moveTo(toX, toY);
        context.lineTo(
            toX - this.arrowSize * Math.cos(angle - Math.PI/6),
            toY - this.arrowSize * Math.sin(angle - Math.PI/6)
        );
        context.lineTo(
            toX - this.arrowSize * Math.cos(angle + Math.PI/6),
            toY - this.arrowSize * Math.sin(angle + Math.PI/6)
        );
        context.closePath();
        context.fill();
        context.restore();
    }
    
    getBounds() {
        if (!this.computedStart || !this.computedEnd) return { x: 0, y: 0, width: 0, height: 0 };
        
        const minX = Math.min(this.computedStart.x, this.computedEnd.x);
        const minY = Math.min(this.computedStart.y, this.computedEnd.y);
        const width = Math.abs(this.computedEnd.x - this.computedStart.x);
        const height = Math.abs(this.computedEnd.y - this.computedStart.y);
        
        return { x: minX, y: minY, width, height };
    }
    
    containsPoint(x, y) {
        if (!this.computedStart || !this.computedEnd) return false;
        
        // Same algorithm as LineObject
        const lineLength = Math.sqrt(
            Math.pow(this.computedEnd.x - this.computedStart.x, 2) + 
            Math.pow(this.computedEnd.y - this.computedStart.y, 2)
        );
        
        if (lineLength < 1) {
            const dx = x - this.computedStart.x;
            const dy = y - this.computedStart.y;
            return Math.sqrt(dx * dx + dy * dy) <= 5;
        }
        
        const t = ((x - this.computedStart.x) * (this.computedEnd.x - this.computedStart.x) + 
                  (y - this.computedStart.y) * (this.computedEnd.y - this.computedStart.y)) / 
                  (lineLength * lineLength);
        
        if (t < 0) {
            const dx = x - this.computedStart.x;
            const dy = y - this.computedStart.y;
            return Math.sqrt(dx * dx + dy * dy) <= 5;
        }
        
        if (t > 1) {
            const dx = x - this.computedEnd.x;
            const dy = y - this.computedEnd.y;
            return Math.sqrt(dx * dx + dy * dy) <= 5;
        }
        
        const px = this.computedStart.x + t * (this.computedEnd.x - this.computedStart.x);
        const py = this.computedStart.y + t * (this.computedEnd.y - this.computedStart.y);
        const dx = x - px;
        const dy = y - py;
        
        return Math.sqrt(dx * dx + dy * dy) <= 5;
    }
    
    // This object type doesn't use the regular move method
    // Instead, it updates the frame/column values
    
    toJSON() {
        const json = super.toJSON();
        return {
            ...json,
            startFrame: this.startFrame,
            startColumn: this.startColumn,
            endFrame: this.endFrame,
            endColumn: this.endColumn,
            dashPattern: this.dashPattern,
            arrowStart: this.arrowStart,
            arrowEnd: this.arrowEnd,
            arrowSize: this.arrowSize
        };
    }
    
    static fromJSON(data) {
        return new FrameSpanningLineObject(data);
    }
}

// Register all object types in a factory
const DrawingObjectFactory = {
    types: {
        'drawingObject': DrawingObject,
        'line': LineObject,
        'arrow': ArrowObject,
        'rectangle': RectangleObject,
        'ellipse': EllipseObject,
        'text': TextObject,
        'image': ImageObject,
        'symbol': SymbolObject,
        'path': PathObject,
        'frameSpanningLine': FrameSpanningLineObject
    },
    
    createFromJSON(data) {
        const Type = this.types[data.type];
        if (Type) {
            return Type.fromJSON(data);
        }
        return null;
    }
};

/**
 * DRAWING TOOL SYSTEM
 * Manages the drawing tools and interfaces with the layer system
 */
class DrawingToolSystem {
    constructor(layerSystem) {
        this.layerSystem = layerSystem;
        this.activeTool = null;
        this.toolSettings = {
            color: '#ff0000',
            lineWidth: 2,
            fill: false,
            fillColor: '#ff8080',
            fontSize: 16,
            fontFamily: 'Arial, sans-serif',
            textAlign: 'left',
            symbolType: 'default',
            symbolScale: 1.0
        };
        
        this.availableTools = {
            'select': new SelectTool(this),
            'pen': new PenTool(this),
            'line': new LineTool(this),
            'arrow': new ArrowTool(this),
            'rectangle': new RectangleTool(this),
            'ellipse': new EllipseTool(this),
            'text': new TextTool(this),
            'image': new ImageTool(this),
            'symbol': new SymbolTool(this),
            'frameLine': new FrameSpanningLineTool(this),
            'eraser': new EraserTool(this)
        };
        
        // Default to select tool
        this.setActiveTool('select');
        
        // Set up toolbar UI
        this.createToolbar();
    }
    
    setActiveTool(toolName) {
        if (this.activeTool) {
            this.activeTool.deactivate();
        }
        
        if (this.availableTools[toolName]) {
            this.activeTool = this.availableTools[toolName];
            this.activeTool.activate();
            return true;
        }
        
        return false;
    }
    
    createToolbar() {
        // Create toolbar container
        const toolbar = document.createElement('div');
        toolbar.className = 'drawing-toolbar';
        toolbar.style.display = 'flex';
        toolbar.style.flexWrap = 'wrap';
        toolbar.style.gap = '5px';
        toolbar.style.padding = '10px';
        toolbar.style.backgroundColor = '#f5f5f5';
        toolbar.style.marginBottom = '10px';
        toolbar.style.borderRadius = '5px';
        
        // Add tool buttons
        this.addToolButton(toolbar, 'select', 'Select', '👆');
        this.addToolButton(toolbar, 'pen', 'Freehand Drawing', '✏️');
        this.addToolButton(toolbar, 'line', 'Line', '—');
        this.addToolButton(toolbar, 'arrow', 'Arrow', '→');
        this.addToolButton(toolbar, 'rectangle', 'Rectangle', '□');
        this.addToolButton(toolbar, 'ellipse', 'Circle/Ellipse', '○');
        this.addToolButton(toolbar, 'text', 'Text', 'T');
        this.addToolButton(toolbar, 'image', 'Insert Image', '🖼️');
        this.addToolButton(toolbar, 'symbol', 'Animation Symbol', '⭐');
        this.addToolButton(toolbar, 'frameLine', 'Multi-Frame Line', '↕️');
        
        // Add separator
        toolbar.appendChild(document.createElement('div')).style.borderLeft = '1px solid #ccc';
        toolbar.lastChild.style.height = '30px';
        
        // Add color picker
        const colorContainer = document.createElement('div');
        colorContainer.style.display = 'flex';
        colorContainer.style.alignItems = 'center';
        colorContainer.style.gap = '5px';
        
        const colorLabel = document.createElement('label');
        colorLabel.textContent = 'Color:';
        colorLabel.htmlFor = 'drawing-color';
        
        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.id = 'drawing-color';
        colorPicker.value = this.toolSettings.color;
        colorPicker.addEventListener('input', (e) => {
            this.toolSettings.color = e.target.value;
        });
        
        colorContainer.appendChild(colorLabel);
        colorContainer.appendChild(colorPicker);
        toolbar.appendChild(colorContainer);
        
        // Add line width selector
        const lineWidthContainer = document.createElement('div');
        lineWidthContainer.style.display = 'flex';
        lineWidthContainer.style.alignItems = 'center';
        lineWidthContainer.style.gap = '5px';
        
        const lineWidthLabel = document.createElement('label');
        lineWidthLabel.textContent = 'Width:';
        lineWidthLabel.htmlFor = 'drawing-line-width';
        
        const lineWidthSelect = document.createElement('select');
        lineWidthSelect.id = 'drawing-line-width';
        
        const widths = [1, 2, 3, 5, 8, 12];
        widths.forEach(width => {
            const option = document.createElement('option');
            option.value = width;
            option.textContent = width + 'px';
            if (width === this.toolSettings.lineWidth) {
                option.selected = true;
            }
            lineWidthSelect.appendChild(option);
        });
        
        lineWidthSelect.addEventListener('change', (e) => {
            this.toolSettings.lineWidth = parseInt(e.target.value);
        });
        
        lineWidthContainer.appendChild(lineWidthLabel);
        lineWidthContainer.appendChild(lineWidthSelect);
        toolbar.appendChild(lineWidthContainer);
        
        // Add fill option
        const fillContainer = document.createElement('div');
        fillContainer.style.display = 'flex';
        fillContainer.style.alignItems = 'center';
        fillContainer.style.gap = '5px';
        
        const fillCheck = document.createElement('input');
        fillCheck.type = 'checkbox';
        fillCheck.id = 'drawing-fill';
        fillCheck.checked = this.toolSettings.fill;
        
        const fillLabel = document.createElement('label');
        fillLabel.textContent = 'Fill';
        fillLabel.htmlFor = 'drawing-fill';
        
        fillCheck.addEventListener('change', (e) => {
            this.toolSettings.fill = e.target.checked;
            fillColorPicker.disabled = !e.target.checked;
        });
        
        const fillColorPicker = document.createElement('input');
        fillColorPicker.type = 'color';
        fillColorPicker.id = 'drawing-fill-color';
        fillColorPicker.value = this.toolSettings.fillColor;
        fillColorPicker.disabled = !this.toolSettings.fill;
        
        fillColorPicker.addEventListener('input', (e) => {
            this.toolSettings.fillColor = e.target.value;
        });
        
        fillContainer.appendChild(fillCheck);
        fillContainer.appendChild(fillLabel);
        fillContainer.appendChild(fillColorPicker);
        toolbar.appendChild(fillContainer);
        
        // Add separator
        toolbar.appendChild(document.createElement('div')).style.borderLeft = '1px solid #ccc';
        toolbar.lastChild.style.height = '30px';
        
        // Add layer selector
        const layerSelector = document.createElement('select');
        layerSelector.id = 'drawing-layer-selector';
        
        // Add options for each layer
        this.layerSystem.layers.forEach((layer, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = layer.name;
            if (index === this.layerSystem.activeLayerIndex) {
                option.selected = true;
            }
            layerSelector.appendChild(option);
        });
        
        layerSelector.addEventListener('change', (e) => {
            this.layerSystem.setActiveLayer(parseInt(e.target.value));
        });
        
        const layerLabel = document.createElement('label');
        layerLabel.textContent = 'Layer:';
        layerLabel.htmlFor = 'drawing-layer-selector';
        layerLabel.style.marginRight = '5px';
        
        toolbar.appendChild(layerLabel);
        toolbar.appendChild(layerSelector);
        
        // Add separator
        toolbar.appendChild(document.createElement('div')).style.borderLeft = '1px solid #ccc';
        toolbar.lastChild.style.height = '30px';
        
        // Add eraser tool
        this.addToolButton(toolbar, 'eraser', 'Eraser', '🧹');
        
        // Add clear button
        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear All Drawings';
        clearButton.style.backgroundColor = '#ff5555';
        clearButton.style.color = 'white';
        clearButton.style.border = 'none';
        clearButton.style.borderRadius = '4px';
        clearButton.style.padding = '5px 10px';
        clearButton.style.cursor = 'pointer';
        
        clearButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all drawings?')) {
                this.layerSystem.clearAllLayers();
            }
        });
        
        toolbar.appendChild(clearButton);
        
        // Find controls div and add toolbar before it
        const controls = document.querySelector('.controls');
        if (controls) {
            controls.parentNode.insertBefore(toolbar, controls.nextSibling);
        } else {
            document.body.insertBefore(toolbar, document.body.firstChild);
        }
    }
    
    addToolButton(toolbar, toolName, tooltip, icon) {
        const button = document.createElement('button');
        button.textContent = icon;
        button.title = tooltip;
        button.style.width = '36px';
        button.style.height = '36px';
        button.style.fontSize = '16px';
        button.style.margin = '0';
        button.style.padding = '5px';
        button.style.borderRadius = '4px';
        button.style.border = '1px solid #ccc';
        button.style.backgroundColor = 'white';
        button.style.cursor = 'pointer';
        
        button.addEventListener('click', () => {
            this.setActiveTool(toolName);
            
            // Update active button styling
            document.querySelectorAll('.drawing-toolbar button').forEach(btn => {
                btn.style.backgroundColor = 'white';
                btn.style.color = 'black';
            });
            
            button.style.backgroundColor = '#4CAF50';
            button.style.color = 'white';
        });
        
        // Set active state for default tool
        if (toolName === 'select') {
            button.style.backgroundColor = '#4CAF50';
            button.style.color = 'white';
        }
        
        toolbar.appendChild(button);
    }
}

/**
 * DRAWING TOOLS
 * Individual tool implementations
 */

// Base tool class
class DrawingTool {
    constructor(toolSystem) {
        this.toolSystem = toolSystem;
        this.layerSystem = toolSystem.layerSystem;
        this.active = false;
        this.settings = toolSystem.toolSettings;
    }
    
    activate() {
        this.active = true;
        this.layerSystem.enableDrawing();
        this.attachEvents();
    }
    
    deactivate() {
        this.active = false;
        this.detachEvents();
    }
    
    attachEvents() {
        // Override in subclasses
    }
    
    detachEvents() {
        // Override in subclasses
    }
}

// Select tool for manipulating objects
class SelectTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.selectedObject = null;
        this.selectedLayer = null;
        this.dragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.objectStart = { x: 0, y: 0 };
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('mousedown', this.handleMouseDown);
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('keydown', this.handleKeyDown);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('keydown', this.handleKeyDown);
        
        // Clear selection
        this.clearSelection();
    }
    
    handleMouseDown = (e) => {
        // Convert to canvas coordinates
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Check if clicked on an object
        const hit = this.layerSystem.findObjectAt(coords.x, coords.y);
        
        if (hit) {
            // Select the object
            this.selectObject(hit.object, hit.layerIndex);
            
            // Start drag
            this.dragging = true;
            this.dragStart = { x: coords.x, y: coords.y };
            this.objectStart = { x: hit.object.x, y: hit.object.y };
        } else {
            // Clear selection if clicked empty space
            this.clearSelection();
        }
    }
    
    handleMouseMove = (e) => {
        if (!this.dragging || !this.selectedObject) return;
        
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Calculate move distance
        const dx = coords.x - this.dragStart.x;
        const dy = coords.y - this.dragStart.y;
        
        // Move the selected object
        this.selectedObject.x = this.objectStart.x + dx;
        this.selectedObject.y = this.objectStart.y + dy;
        
        // For objects with special move handling
        this.selectedObject.move(dx, dy);
        this.selectedObject.x = this.objectStart.x; // Reset x as move() already handled it
        this.selectedObject.y = this.objectStart.y; // Reset y as move() already handled it
        
        // Redraw
        this.layerSystem.redrawAll();
    }
    
    handleMouseUp = () => {
        this.dragging = false;
    }
    
    handleKeyDown = (e) => {
        if (!this.selectedObject) return;
        
        // Delete key
        if (e.key === 'Delete' || e.key === 'Backspace') {
            this.layerSystem.removeObject(this.selectedObject, this.selectedLayer);
            this.clearSelection();
        }
        
        // Arrow keys for fine movement
        const moveDistance = e.shiftKey ? 10 : 1;
        
        if (e.key === 'ArrowLeft') {
            this.selectedObject.move(-moveDistance, 0);
            this.layerSystem.redrawAll();
        } else if (e.key === 'ArrowRight') {
            this.selectedObject.move(moveDistance, 0);
            this.layerSystem.redrawAll();
        } else if (e.key === 'ArrowUp') {
            this.selectedObject.move(0, -moveDistance);
            this.layerSystem.redrawAll();
        } else if (e.key === 'ArrowDown') {
            this.selectedObject.move(0, moveDistance);
            this.layerSystem.redrawAll();
        }
    }
    
    selectObject(object, layerIndex) {
        // Clear previous selection
        this.clearSelection();
        
        // Set new selection
        this.selectedObject = object;
        this.selectedLayer = layerIndex;
        object.selected = true;
        
        // Redraw with selection visual
        this.layerSystem.redrawAll();
    }
    
    clearSelection() {
        if (this.selectedObject) {
            this.selectedObject.selected = false;
            this.selectedObject = null;
            this.selectedLayer = null;
            this.layerSystem.redrawAll();
        }
    }
}

// Pen tool for free drawing
class PenTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.currentPath = null;
        this.drawing = false;
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('mousedown', this.handleMouseDown);
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        
        // Finish any in-progress drawing
        this.finishDrawing();
    }
    
    handleMouseDown = (e) => {
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Start a new path
        this.currentPath = new PathObject({
            color: this.settings.color,
            lineWidth: this.settings.lineWidth,
            x: coords.x,
            y: coords.y
        });
        
        this.currentPath.addPoint(coords.x, coords.y);
        this.drawing = true;
        
        // Add to layer
        this.layerSystem.addObject(this.currentPath);
    }
    
    handleMouseMove = (e) => {
        if (!this.drawing || !this.currentPath) return;
        
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Add point to path
        this.currentPath.addPoint(coords.x, coords.y);
        
        // Redraw
        this.layerSystem.redrawLayer(this.layerSystem.activeLayerIndex);
    }
    
    handleMouseUp = () => {
        this.finishDrawing();
    }
    
    finishDrawing() {
        if (this.drawing && this.currentPath) {
            // Finish the path
            this.drawing = false;
            this.currentPath = null;
        }
    }
}

// Line tool
class LineTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.startPoint = null;
        this.currentLine = null;
        this.drawing = false;
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('mousedown', this.handleMouseDown);
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        
        // Finish any in-progress drawing
        this.finishDrawing();
    }
    
    handleMouseDown = (e) => {
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        this.startPoint = coords;
        
        // Create temporary line
        this.currentLine = new LineObject({
            x: coords.x,
            y: coords.y,
            x2: coords.x,
            y2: coords.y,
            color: this.settings.color,
            lineWidth: this.settings.lineWidth
        });
        
        this.drawing = true;
        
        // Add to layer
        this.layerSystem.addObject(this.currentLine);
    }
    
    handleMouseMove = (e) => {
        if (!this.drawing || !this.currentLine) return;
        
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Update end point
        this.currentLine.x2 = coords.x;
        this.currentLine.y2 = coords.y;
        
        // Redraw
        this.layerSystem.redrawLayer(this.layerSystem.activeLayerIndex);
    }
    
    handleMouseUp = () => {
        this.finishDrawing();
    }
    
    finishDrawing() {
        if (this.drawing && this.currentLine) {
            // Finish the line
            this.drawing = false;
            this.startPoint = null;
            this.currentLine = null;
        }
    }
}

// Arrow tool (extends Line tool)
class ArrowTool extends LineTool {
    handleMouseDown = (e) => {
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        this.startPoint = coords;
        
        // Create temporary arrow
        this.currentLine = new ArrowObject({
            x: coords.x,
            y: coords.y,
            x2: coords.x,
            y2: coords.y,
            color: this.settings.color,
            lineWidth: this.settings.lineWidth
        });
        
        this.drawing = true;
        
        // Add to layer
        this.layerSystem.addObject(this.currentLine);
    }
}

// Rectangle tool
class RectangleTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.startPoint = null;
        this.currentRect = null;
        this.drawing = false;
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('mousedown', this.handleMouseDown);
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        
        // Finish any in-progress drawing
        this.finishDrawing();
    }
    
    handleMouseDown = (e) => {
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        this.startPoint = coords;
        
        // Create temporary rectangle
        this.currentRect = new RectangleObject({
            x: coords.x,
            y: coords.y,
            width: 0,
            height: 0,
            color: this.settings.color,
            lineWidth: this.settings.lineWidth,
            fill: this.settings.fill,
            fillColor: this.settings.fillColor
        });
        
        this.drawing = true;
        
        // Add to layer
        this.layerSystem.addObject(this.currentRect);
    }
    
    handleMouseMove = (e) => {
        if (!this.drawing || !this.currentRect) return;
        
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Update dimensions
        const width = coords.x - this.startPoint.x;
        const height = coords.y - this.startPoint.y;
        
        if (width < 0) {
            this.currentRect.x = coords.x;
            this.currentRect.width = Math.abs(width);
        } else {
            this.currentRect.x = this.startPoint.x;
            this.currentRect.width = width;
        }
        
        if (height < 0) {
            this.currentRect.y = coords.y;
            this.currentRect.height = Math.abs(height);
        } else {
            this.currentRect.y = this.startPoint.y;
            this.currentRect.height = height;
        }
        
        // Redraw
        this.layerSystem.redrawLayer(this.layerSystem.activeLayerIndex);
    }
    
    handleMouseUp = () => {
        this.finishDrawing();
    }
    
    finishDrawing() {
        if (this.drawing && this.currentRect) {
            // Finish the rectangle
            this.drawing = false;
            this.startPoint = null;
            this.currentRect = null;
        }
    }
}

// Ellipse tool
class EllipseTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.center = null;
        this.currentEllipse = null;
        this.drawing = false;
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('mousedown', this.handleMouseDown);
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        
        // Finish any in-progress drawing
        this.finishDrawing();
    }
    
    handleMouseDown = (e) => {
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        this.center = coords;
        
        // Create temporary ellipse
        this.currentEllipse = new EllipseObject({
            x: coords.x,
            y: coords.y,
            radiusX: 0,
            radiusY: 0,
            color: this.settings.color,
            lineWidth: this.settings.lineWidth,
            fill: this.settings.fill,
            fillColor: this.settings.fillColor
        });
        
        this.drawing = true;
        
        // Add to layer
        this.layerSystem.addObject(this.currentEllipse);
    }
    
    handleMouseMove = (e) => {
        if (!this.drawing || !this.currentEllipse) return;
        
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Update radii
        this.currentEllipse.radiusX = Math.abs(coords.x - this.center.x);
        this.currentEllipse.radiusY = Math.abs(coords.y - this.center.y);
        
        // Redraw
        this.layerSystem.redrawLayer(this.layerSystem.activeLayerIndex);
    }
    
    handleMouseUp = () => {
        this.finishDrawing();
    }
    
    finishDrawing() {
        if (this.drawing && this.currentEllipse) {
            // Finish the ellipse
            this.drawing = false;
            this.center = null;
            this.currentEllipse = null;
        }
    }
}

// Text tool
class TextTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.textInput = null;
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('click', this.handleClick);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('click', this.handleClick);
        
        // Remove any active text input
        this.removeTextInput();
    }
    
    handleClick = (e) => {
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Show text input at click position
        this.showTextInput(coords.x, coords.y);
    }
    
    showTextInput(x, y) {
        // Remove any existing text input
        this.removeTextInput();
        
        // Create text input element
        this.textInput = document.createElement('div');
        this.textInput.style.position = 'absolute';
        this.textInput.style.zIndex = '100';
        
        // Position relative to canvas
        const canvasRect = this.layerSystem.container.getBoundingClientRect();
        this.textInput.style.left = (canvasRect.left + x) + 'px';
        this.textInput.style.top = (canvasRect.top + y) + 'px';
        
        // Style the input
        this.textInput.style.backgroundColor = 'white';
        this.textInput.style.border = '1px solid #ccc';
        this.textInput.style.padding = '5px';
        this.textInput.style.borderRadius = '3px';
        this.textInput.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        
        // Create the actual input
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Enter text...';
        input.style.width = '200px';
        input.style.padding = '5px';
        input.style.border = '1px solid #ddd';
        input.style.borderRadius = '3px';
        
        // Create font size selector
        const sizeSelect = document.createElement('select');
        [8, 10, 12, 14, 16, 18, 20, 24, 36].forEach(size => {
            const option = document.createElement('option');
            option.value = size;
            option.textContent = size + 'px';
            if (size === this.settings.fontSize) {
                option.selected = true;
            }
            sizeSelect.appendChild(option);
        });
        
        sizeSelect.addEventListener('change', (e) => {
            this.settings.fontSize = parseInt(e.target.value);
        });
        
        // Create alignment options
        const alignmentDiv = document.createElement('div');
        alignmentDiv.style.display = 'flex';
        alignmentDiv.style.marginTop = '5px';
        
        ['left', 'center', 'right'].forEach(align => {
            const button = document.createElement('button');
            button.textContent = align[0].toUpperCase();
            button.style.flex = '1';
            button.style.padding = '2px 5px';
            button.style.backgroundColor = this.settings.textAlign === align ? '#4CAF50' : '#f1f1f1';
            button.style.color = this.settings.textAlign === align ? 'white' : 'black';
            button.style.border = '1px solid #ccc';
            button.style.cursor = 'pointer';
            
            button.addEventListener('click', () => {
                this.settings.textAlign = align;
                alignmentDiv.querySelectorAll('button').forEach(btn => {
                    btn.style.backgroundColor = '#f1f1f1';
                    btn.style.color = 'black';
                });
                button.style.backgroundColor = '#4CAF50';
                button.style.color = 'white';
            });
            
            alignmentDiv.appendChild(button);
        });
        
        // Add UI elements to the container
        this.textInput.appendChild(input);
        this.textInput.appendChild(document.createElement('br'));
        this.textInput.appendChild(document.createTextNode('Size: '));
        this.textInput.appendChild(sizeSelect);
        this.textInput.appendChild(document.createElement('br'));
        this.textInput.appendChild(alignmentDiv);
        
        // Add buttons container
        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.marginTop = '5px';
        buttons.style.gap = '5px';
        
        // Add button
        const addButton = document.createElement('button');
        addButton.textContent = 'Add Text';
        addButton.style.flex = '1';
        addButton.style.padding = '5px';
        addButton.style.backgroundColor = '#4CAF50';
        addButton.style.color = 'white';
        addButton.style.border = 'none';
        addButton.style.borderRadius = '3px';
        addButton.style.cursor = 'pointer';
        
        addButton.addEventListener('click', () => {
            this.addText(x, y, input.value);
        });
        
        // Cancel button
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.flex = '1';
        cancelButton.style.padding = '5px';
        cancelButton.style.backgroundColor = '#f44336';
        cancelButton.style.color = 'white';
        cancelButton.style.border = 'none';
        cancelButton.style.borderRadius = '3px';
        cancelButton.style.cursor = 'pointer';
        
        cancelButton.addEventListener('click', () => {
            this.removeTextInput();
        });
        
        buttons.appendChild(addButton);
        buttons.appendChild(cancelButton);
        this.textInput.appendChild(buttons);
        
        // Add to document
        document.body.appendChild(this.textInput);
        
        // Focus the input
        input.focus();
        
        // Handle enter key
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.addText(x, y, input.value);
            } else if (e.key === 'Escape') {
                this.removeTextInput();
            }
        });
    }
    
    removeTextInput() {
        if (this.textInput && this.textInput.parentNode) {
            this.textInput.parentNode.removeChild(this.textInput);
            this.textInput = null;
        }
    }
    
    addText(x, y, text) {
        if (!text.trim()) {
            this.removeTextInput();
            return;
        }
        
        // Create text object
        const textObj = new TextObject({
            x: x,
            y: y,
            text: text,
            color: this.settings.color,
            fontSize: this.settings.fontSize,
            fontFamily: this.settings.fontFamily,
            align: this.settings.textAlign
        });
        
        // Add to layer
        this.layerSystem.addObject(textObj);
        
        // Remove text input
        this.removeTextInput();
    }
}

// Image tool
class ImageTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.fileInput = null;
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('click', this.handleClick);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('click', this.handleClick);
    }
    
    handleClick = (e) => {
        // Show file upload dialog
        this.showFileDialog();
    }
    
    showFileDialog() {
        // Create hidden file input if it doesn't exist
        if (!this.fileInput) {
            this.fileInput = document.createElement('input');
            this.fileInput.type = 'file';
            this.fileInput.accept = 'image/*';
            this.fileInput.style.display = 'none';
            document.body.appendChild(this.fileInput);
            
            this.fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    this.handleFileSelect(e.target.files[0]);
                }
            });
        }
        
        // Trigger file dialog
        this.fileInput.click();
    }
    
    handleFileSelect(file) {
        // Read the file and create a data URL
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            
            // Show image placement UI
            this.showImagePlacementUI(imageUrl);
        };
        
        reader.readAsDataURL(file);
    }
    
    showImagePlacementUI(imageUrl) {
        // Create a preview image to get dimensions
        const img = new Image();
        
        img.onload = () => {
            // Calculate dimensions (max size 300px width/height while maintaining aspect ratio)
            let width = img.width;
            let height = img.height;
            
            const maxSize = 300;
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = (height / width) * maxSize;
                    width = maxSize;
                } else {
                    width = (width / height) * maxSize;
                    height = maxSize;
                }
            }
            
            // Create placement UI
            const placementUI = document.createElement('div');
            placementUI.style.position = 'fixed';
            placementUI.style.top = '50%';
            placementUI.style.left = '50%';
            placementUI.style.transform = 'translate(-50%, -50%)';
            placementUI.style.backgroundColor = 'white';
            placementUI.style.padding = '20px';
            placementUI.style.borderRadius = '5px';
            placementUI.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
            placementUI.style.zIndex = '1000';
            
            // Add heading
            const heading = document.createElement('h3');
            heading.textContent = 'Place Image';
            heading.style.margin = '0 0 10px 0';
            
            // Add image preview
            const preview = document.createElement('img');
            preview.src = imageUrl;
            preview.style.maxWidth = '300px';
            preview.style.maxHeight = '300px';
            preview.style.display = 'block';
            preview.style.marginBottom = '10px';
            
            // Size controls
            const sizeControls = document.createElement('div');
            sizeControls.style.marginBottom = '10px';
            
            const widthLabel = document.createElement('label');
            widthLabel.textContent = 'Width: ';
            const widthInput = document.createElement('input');
            widthInput.type = 'number';
            widthInput.value = Math.round(width);
            widthInput.style.width = '60px';
            
            const heightLabel = document.createElement('label');
            heightLabel.textContent = 'Height: ';
            heightLabel.style.marginLeft = '10px';
            const heightInput = document.createElement('input');
            heightInput.type = 'number';
            heightInput.value = Math.round(height);
            heightInput.style.width = '60px';
            
            // Maintain aspect ratio
            const aspectRatio = img.width / img.height;
            
            widthInput.addEventListener('input', () => {
                const newWidth = parseInt(widthInput.value);
                if (!isNaN(newWidth)) {
                    heightInput.value = Math.round(newWidth / aspectRatio);
                }
            });
            
            heightInput.addEventListener('input', () => {
                const newHeight = parseInt(heightInput.value);
                if (!isNaN(newHeight)) {
                    widthInput.value = Math.round(newHeight * aspectRatio);
                }
            });
            
            sizeControls.appendChild(widthLabel);
            sizeControls.appendChild(widthInput);
            sizeControls.appendChild(heightLabel);
            sizeControls.appendChild(heightInput);
            
            // Buttons container
            const buttons = document.createElement('div');
            buttons.style.display = 'flex';
            buttons.style.justifyContent = 'space-between';
            buttons.style.marginTop = '15px';
            
            // Place button
            const placeButton = document.createElement('button');
            placeButton.textContent = 'Place Image';
            placeButton.style.padding = '8px 15px';
            placeButton.style.backgroundColor = '#4CAF50';
            placeButton.style.color = 'white';
            placeButton.style.border = 'none';
            placeButton.style.borderRadius = '4px';
            placeButton.style.cursor = 'pointer';
            
            placeButton.addEventListener('click', () => {
                // Get center of view as placement position
                const containerRect = this.layerSystem.container.getBoundingClientRect();
                const x = containerRect.width / 2;
                const y = containerRect.height / 2;
                
                // Get dimensions from inputs
                const finalWidth = parseInt(widthInput.value);
                const finalHeight = parseInt(heightInput.value);
                
                // Create and add image object
                const imageObj = new ImageObject({
                    x: x - finalWidth / 2,
                    y: y - finalHeight / 2,
                    width: finalWidth,
                    height: finalHeight,
                    imageUrl: imageUrl
                });
                
                this.layerSystem.addObject(imageObj);
                
                // Remove UI
                document.body.removeChild(placementUI);
            });
            
            // Cancel button
            const cancelButton = document.createElement('button');
            cancelButton.textContent = 'Cancel';
            cancelButton.style.padding = '8px 15px';
            cancelButton.style.backgroundColor = '#f44336';
            cancelButton.style.color = 'white';
            cancelButton.style.border = 'none';
            cancelButton.style.borderRadius = '4px';
            cancelButton.style.cursor = 'pointer';
            
            cancelButton.addEventListener('click', () => {
                document.body.removeChild(placementUI);
            });
            
            buttons.appendChild(cancelButton);
            buttons.appendChild(placeButton);
            
            // Assemble UI
            placementUI.appendChild(heading);
            placementUI.appendChild(preview);
            placementUI.appendChild(sizeControls);
            placementUI.appendChild(buttons);
            
            // Add to document
            document.body.appendChild(placementUI);
        };
        
        img.src = imageUrl;
    }
}

// Symbol tool
class SymbolTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.symbolSelector = null;
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('click', this.handleClick);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('click', this.handleClick);
        
        // Remove any active symbol selector
        this.removeSymbolSelector();
    }
    
    handleClick = (e) => {
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Show symbol selector
        this.showSymbolSelector(coords.x, coords.y);
    }
    
    showSymbolSelector(x, y) {
        // Remove existing selector if any
        this.removeSymbolSelector();
        
        // Create symbol selector
        this.symbolSelector = document.createElement('div');
        this.symbolSelector.style.position = 'absolute';
        this.symbolSelector.style.zIndex = '100';
        
        // Position relative to canvas
        const canvasRect = this.layerSystem.container.getBoundingClientRect();
        this.symbolSelector.style.left = (canvasRect.left + x + 10) + 'px';
        this.symbolSelector.style.top = (canvasRect.top + y + 10) + 'px';
        
        // Style
        this.symbolSelector.style.backgroundColor = 'white';
        this.symbolSelector.style.border = '1px solid #ccc';
        this.symbolSelector.style.padding = '10px';
        this.symbolSelector.style.borderRadius = '5px';
        this.symbolSelector.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
        
        // Add title
        const title = document.createElement('h4');
        title.textContent = 'Select Animation Symbol';
        title.style.margin = '0 0 10px 0';
        this.symbolSelector.appendChild(title);
        
        // Symbol grid
        const symbolGrid = document.createElement('div');
        symbolGrid.style.display = 'grid';
        symbolGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
        symbolGrid.style.gap = '10px';
        symbolGrid.style.marginBottom = '10px';
        
        // Available symbols
        const symbols = [
            { type: 'anticipation', name: 'Anticipation' },
            { type: 'impact', name: 'Impact' },
            { type: 'keyframe', name: 'Keyframe' },
            { type: 'inbetween', name: 'Inbetween' },
            { type: 'hold', name: 'Hold' },
            { type: 'default', name: 'Default' }
        ];
        
        // Create symbol preview for each type
        symbols.forEach(symbol => {
            const symbolItem = document.createElement('div');
            symbolItem.style.display = 'flex';
            symbolItem.style.flexDirection = 'column';
            symbolItem.style.alignItems = 'center';
            symbolItem.style.cursor = 'pointer';
            symbolItem.style.padding = '5px';
            symbolItem.style.border = '1px solid #ddd';
            symbolItem.style.borderRadius = '3px';
            
            // Create canvas for symbol preview
            const canvas = document.createElement('canvas');
            canvas.width = 50;
            canvas.height = 50;
            const ctx = canvas.getContext('2d');
            
            // Draw symbol preview
            ctx.save();
            ctx.strokeStyle = this.settings.color;
            ctx.fillStyle = this.settings.color;
            ctx.lineWidth = 2;
            
            // Draw centered preview
            const symbolObj = new SymbolObject({
                x: 25,
                y: 25,
                symbolType: symbol.type,
                color: this.settings.color,
                lineWidth: 2,
                scale: 1.5
            });
            
            symbolObj.draw(ctx);
            ctx.restore();
            
            const name = document.createElement('div');
            name.textContent = symbol.name;
            name.style.marginTop = '5px';
            name.style.fontSize = '12px';
            
            symbolItem.appendChild(canvas);
            symbolItem.appendChild(name);
            
            // Add click handler
            symbolItem.addEventListener('click', () => {
                this.addSymbol(x, y, symbol.type);
                this.removeSymbolSelector();
            });
            
            symbolGrid.appendChild(symbolItem);
        });
        
        this.symbolSelector.appendChild(symbolGrid);
        
        // Scale control
        const scaleContainer = document.createElement('div');
        scaleContainer.style.display = 'flex';
        scaleContainer.style.alignItems = 'center';
        scaleContainer.style.marginBottom = '10px';
        
        const scaleLabel = document.createElement('label');
        scaleLabel.textContent = 'Scale: ';
        
        const scaleInput = document.createElement('input');
        scaleInput.type = 'range';
        scaleInput.min = '0.5';
        scaleInput.max = '3';
        scaleInput.step = '0.1';
        scaleInput.value = this.settings.symbolScale;
        scaleInput.style.flex = '1';
        scaleInput.style.marginLeft = '5px';
        
        const scaleValue = document.createElement('span');
        scaleValue.textContent = this.settings.symbolScale + 'x';
        scaleValue.style.marginLeft = '5px';
        scaleValue.style.width = '30px';
        
        scaleInput.addEventListener('input', () => {
            this.settings.symbolScale = parseFloat(scaleInput.value);
            scaleValue.textContent = this.settings.symbolScale + 'x';
        });
        
        scaleContainer.appendChild(scaleLabel);
        scaleContainer.appendChild(scaleInput);
        scaleContainer.appendChild(scaleValue);
        
        this.symbolSelector.appendChild(scaleContainer);
        
        // Add cancel button
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.width = '100%';
        cancelButton.style.padding = '5px';
        cancelButton.style.backgroundColor = '#f44336';
        cancelButton.style.color = 'white';
        cancelButton.style.border = 'none';
        cancelButton.style.borderRadius = '3px';
        cancelButton.style.cursor = 'pointer';
        
        cancelButton.addEventListener('click', () => {
            this.removeSymbolSelector();
        });
        
        this.symbolSelector.appendChild(cancelButton);
        
        // Add to document
        document.body.appendChild(this.symbolSelector);
    }
    
    removeSymbolSelector() {
        if (this.symbolSelector && this.symbolSelector.parentNode) {
            this.symbolSelector.parentNode.removeChild(this.symbolSelector);
            this.symbolSelector = null;
        }
    }
    
    addSymbol(x, y, symbolType) {
        // Create symbol object
        const symbolObj = new SymbolObject({
            x: x,
            y: y,
            symbolType: symbolType,
            color: this.settings.color,
            lineWidth: this.settings.lineWidth,
            scale: this.settings.symbolScale
        });
        
        // Add to layer
        this.layerSystem.addObject(symbolObj);
    }
}

// Frame-spanning line tool (for connecting cells across frames)
class FrameSpanningLineTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
        this.startCell = null;
        this.currentLine = null;
        this.drawing = false;
    }
    
    attachEvents() {
        // This tool works with the table cells, not the canvas
        this.setupCellEvents();
    }
    
    detachEvents() {
        this.removeCellEvents();
        
        // Finish any in-progress drawing
        this.finishDrawing();
    }
    
    setupCellEvents() {
        // Find all table cells and add mousedown handler
        const cells = document.querySelectorAll('#xsheet-table td');
        cells.forEach(cell => {
            cell.addEventListener('mousedown', this.handleCellMouseDown);
            cell.addEventListener('mouseup', this.handleCellMouseUp);
            
            // Add hover effect
            cell.addEventListener('mouseover', this.handleCellHover);
            cell.addEventListener('mouseout', this.handleCellOut);
            
            // Store original background for hover effect
            if (!cell.dataset.originalBg) {
                cell.dataset.originalBg = cell.style.backgroundColor || '';
            }
        });
    }
    
    removeCellEvents() {
        const cells = document.querySelectorAll('#xsheet-table td');
        cells.forEach(cell => {
            cell.removeEventListener('mousedown', this.handleCellMouseDown);
            cell.removeEventListener('mouseup', this.handleCellMouseUp);
            cell.removeEventListener('mouseover', this.handleCellHover);
            cell.removeEventListener('mouseout', this.handleCellOut);
            
            // Restore original background
            if (cell.dataset.originalBg) {
                cell.style.backgroundColor = cell.dataset.originalBg;
            }
        });
    }
    
    handleCellHover = (e) => {
        const cell = e.currentTarget;
        cell.style.backgroundColor = 'rgba(0, 123, 255, 0.2)';
    }
    
    handleCellOut = (e) => {
        const cell = e.currentTarget;
        if (!this.drawing || cell !== this.startCell) {
            cell.style.backgroundColor = cell.dataset.originalBg || '';
        }
    }
    
    handleCellMouseDown = (e) => {
        const cell = e.currentTarget;
        
        // Find the row and column index
        const row = cell.parentElement;
        const frameNumber = parseInt(row.getAttribute('data-frame') || row.className.replace('frame-', ''));
        const columnIndex = Array.from(row.children).indexOf(cell) + 1;
        
        if (isNaN(frameNumber) || frameNumber <= 0) return;
        
        // Store as start cell
        this.startCell = cell;
        this.drawing = true;
        
        // Highlight the cell
        cell.style.backgroundColor = 'rgba(0, 123, 255, 0.4)';
        
        // Create temporary frame-spanning line object
        this.currentLine = new FrameSpanningLineObject({
            startFrame: frameNumber,
            startColumn: columnIndex,
            endFrame: frameNumber,
            endColumn: columnIndex,
            color: this.settings.color,
            lineWidth: this.settings.lineWidth,
            arrowEnd: true
        });
        
        // Add to layer
        this.layerSystem.addObject(this.currentLine);
    }
    
    handleCellMouseUp = (e) => {
        if (!this.drawing || !this.currentLine) return;
        
        const cell = e.currentTarget;
        
        // Skip if this is the same cell
        if (cell === this.startCell) {
            this.finishDrawing();
            return;
        }
        
        // Find the row and column index
        const row = cell.parentElement;
        const frameNumber = parseInt(row.getAttribute('data-frame') || row.className.replace('frame-', ''));
        const columnIndex = Array.from(row.children).indexOf(cell) + 1;
        
        if (isNaN(frameNumber) || frameNumber <= 0) {
            this.finishDrawing();
            return;
        }
        
        // Update the end point of the line
        this.currentLine.endFrame = frameNumber;
        this.currentLine.endColumn = columnIndex;
        
        // Redraw
        this.layerSystem.redrawLayer(this.layerSystem.activeLayerIndex);
        
        // Finish drawing
        this.finishDrawing();
    }
    
    finishDrawing() {
        if (this.drawing) {
            // Reset flags
            this.drawing = false;
            
            // If the line is too short (same start and end), remove it
            if (this.currentLine && 
                this.currentLine.startFrame === this.currentLine.endFrame && 
                this.currentLine.startColumn === this.currentLine.endColumn) {
                this.layerSystem.removeObject(this.currentLine);
            }
            
            // Clear current line reference
            this.currentLine = null;
            
            // Reset cell highlights
            if (this.startCell) {
                this.startCell.style.backgroundColor = this.startCell.dataset.originalBg || '';
                this.startCell = null;
            }
        }
    }
}

// Eraser tool
class EraserTool extends DrawingTool {
    constructor(toolSystem) {
        super(toolSystem);
    }
    
    attachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.addEventListener('mousedown', this.handleMouseDown);
    }
    
    detachEvents() {
        const canvas = this.layerSystem.getActiveLayer().canvas;
        
        canvas.removeEventListener('mousedown', this.handleMouseDown);
    }
    
    handleMouseDown = (e) => {
        const coords = this.layerSystem.screenToCanvas(e.clientX, e.clientY);
        
        // Find object at click position
        const hit = this.layerSystem.findObjectAt(coords.x, coords.y);
        
        if (hit) {
            // Remove the object
            this.layerSystem.removeObject(hit.object, hit.layerIndex);
        }
    }
}

/**
 * INTEGRATION WITH X-SHEET APPLICATION
 * 
 * Initialize the drawing system, save/load integration, and PDF/print handling
 */

// Initialize drawing system when document is loaded
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
        
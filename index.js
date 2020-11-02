const ALIGNER_FULLNESS = 0.4;
const ALIGNER_FULLNESS_TOLERANCE = 0.2;
const ALIGNER_SQUARENESS_TOLERANCE = 2.0;
const MAX_TARGET_AREA_FRACTION = 0.2;

const MAX_SQUARENESS = 5.0;
const NOISE_FULLNESS_THRESHOLD = 0.1; // this means less than one percent of the target is filled in
const NOISE_IMAGE_FILLED_THRESHOLD = 0.0001;

// const BAR_TARGET_AREA = 0.0003;
// const BAR_TARGET_AREA_TOLERANCE = 0.0002;
// const BAR_SQUARENESS = 3.0;
// const BAR_SQUARENESS_TOLERANCE = 2.0;

const greyCanv = document.getElementById('greyCanvas');
const greyCtx = greyCanv.getContext('2d');

const debugCanv = document.getElementById('debugCanvas');
const debugCtx = debugCanv.getContext('2d');
const DEBUG_CANVAS_WIDTH = 1000;
const DEBUG_CANVAS_HEIGHT = 1000;
debugCanv.width = DEBUG_CANVAS_WIDTH;
debugCanv.height = DEBUG_CANVAS_HEIGHT;



let threshold = 128;
let greyscale;
let blackAndWhite;

document.getElementById('processButton').onclick = () => {
    const targets = new Aligners(blackAndWhite);

    //targets.display(greyCtx);

};

document.getElementById('thresholdSlider').oninput = () => {
    const slider = document.getElementById('thresholdSlider');
    threshold = slider.value;

    blackAndWhite = new BlackAndWhite(greyscale, threshold);
    blackAndWhite.drawOnContext(greyCtx);
};

document.getElementById('formImageInput').oninput = () => {
    const reader = new FileReader();

    reader.onload = (result) => {
        const file = result.target.result;

        const canvas = document.getElementById('previewCanvas');
        const ctx = canvas.getContext('2d');
    
        const previewImg = document.getElementById('imageUploadPreview');
        previewImg.src = file;

        previewImg.onload = () => {
            greyCanv.width = previewImg.width;
            greyCanv.height = previewImg.height;
    
            // draw it on the canvas
            canvas.width = previewImg.width;
            canvas.height = previewImg.height;

            ctx.drawImage(previewImg, 0, 0);
                
            greyscale = new Greyscale(ctx.getImageData(0, 0, previewImg.width, previewImg.height));

            blackAndWhite = new BlackAndWhite(greyscale, threshold);
            blackAndWhite.drawOnContext(greyCtx, threshold);
        };
    };

    const input = document.getElementById('formImageInput');
    reader.readAsDataURL(input.files[0]);
};

function floodFill(x, y, blackAndWhite, hasSeen) {
    // now know !hasSeen.set(x, y) and greyscale.isSet(x, y)

    const width = blackAndWhite.width;
    const height = blackAndWhite.height;

    // use these variables to identify target once its found
    let top = y,
        bottom = y,
        left = x,
        right = x,
        xSum = 0,
        ySum = 0,
        pixelsFilled = 0;

    const stack = [[x, y]];
    
    while (stack.length > 0) {
        const [a, b] = stack.pop();

        // pixel must have been colored after it was pushed on 
        if (hasSeen.isSet(a, b)) continue;  
        hasSeen.set(a, b);

        pixelsFilled += 1;
        xSum += a;
        ySum += b;

        left = Math.min(left, a);
        top = Math.min(top, b);
        right = Math.max(right, a);
        bottom = Math.max(bottom, b);

        if (a > 0 && blackAndWhite.isSet(a-1, b)) stack.push([a-1, b]);
        if (b > 0 && blackAndWhite.isSet(a, b-1)) stack.push([a, b-1]);
        if (a < width-1 && blackAndWhite.isSet(a+1, b)) stack.push([a+1, b]);
        if (b < height-1 && blackAndWhite.isSet(a, b+1)) stack.push([a, b+1]);
    }

    return new Aligner(left, right, top, bottom, pixelsFilled, xSum, ySum, width, height);
}

class Aligner {
    constructor(left, right, top, bottom, pixelsFilled, xSum, ySum, imageWidth, imageHeight) {
        const imageArea = imageWidth * imageHeight;

        const meanX = xSum / pixelsFilled;
        const meanY = ySum / pixelsFilled;

        this.left = left / imageWidth;
        this.right = right / imageWidth;
        this.top = top / imageHeight;
        this.bottom = bottom / imageHeight;
        this.fractionOfImageFilled = pixelsFilled / imageArea;
        this.meanX = meanX / imageWidth;
        this.meanY = meanY / imageHeight;

        const targetWidth = right - left + 1;
        const targetHeight = bottom - top + 1;
        this.targetArea = targetWidth * targetHeight;
        const targetAreaFraction = this.targetArea / imageArea;

        const imageFilledFraction = pixelsFilled / imageArea;

        const squareness = (targetWidth > targetHeight) ? targetWidth / targetHeight : targetHeight / targetWidth;
        const fullness = pixelsFilled / this.targetArea;


        this.isAligner = 
            !(fullness < NOISE_FULLNESS_THRESHOLD
                || imageFilledFraction < NOISE_IMAGE_FILLED_THRESHOLD
                || squareness > MAX_SQUARENESS
                || targetAreaFraction > MAX_TARGET_AREA_FRACTION)

            && (squareness < ALIGNER_SQUARENESS_TOLERANCE
                && Math.abs(fullness - ALIGNER_FULLNESS) < ALIGNER_FULLNESS_TOLERANCE);
    }
}

class Aligners {
    constructor(blackAndWhite) {
        const width = blackAndWhite.width;
        const height = blackAndWhite.height;

        const hasSeen = new HasSeen(width, height);

        this.aligners = [];

        for (let y=0; y<height; y++) {
            for (let x=0; x<width; x++) {
                if (!blackAndWhite.isSet(x, y) || hasSeen.isSet(x, y)) continue;

                let maybeAligner = floodFill(x, y, blackAndWhite, hasSeen);

                if (maybeAligner.isAligner) this.aligners.push(maybeAligner);
            }
        }

        // choose the 4 largest:
        this.aligners.sort((a, b) => {
            a.targetArea - b.targetArea
        });
        this.aligners = this.aligners.slice(0, 4);

        if (this.aligners.length !== 4) {
            console.log('missing aligner');
        }

        // put the rest of the aligners in a consistent ordering:
        const news = [];

        this.aligners.sort((a, b) => (a.meanX + a.meanY) - (b.meanX + b.meanY)); // top left
        news.push(this.aligners.shift());

        this.aligners.sort((a, b) => (b.meanX - b.meanY) - (a.meanX - a.meanY)); // top right
        news.push(this.aligners.shift());

        this.aligners.sort((a, b) => (b.meanX + b.meanY) - (a.meanX + a.meanY)); // bottom right
        news.push(this.aligners.shift());

        this.aligners.sort((a, b) => (a.meanX - a.meanY) - (b.meanX - b.meanY)); // bottom left
        news.push(this.aligners.shift());

        this.aligners = news;

        const src = [
            [width*this.aligners[0].meanX, height*this.aligners[0].meanY],
            [width*this.aligners[1].meanX, height*this.aligners[1].meanY],
            [width*this.aligners[2].meanX, height*this.aligners[2].meanY],
            [width*this.aligners[3].meanX, height*this.aligners[3].meanY],
        ];

        const dst = [
            [0, 0],
            [DEBUG_CANVAS_WIDTH, 0],
            [DEBUG_CANVAS_WIDTH, DEBUG_CANVAS_HEIGHT],
            [0, DEBUG_CANVAS_HEIGHT],
        ];

        const transfromMatrix = Matrix.fromPerspectiveTransform(src, dst);

        const data = new Uint8ClampedArray(4*DEBUG_CANVAS_WIDTH*DEBUG_CANVAS_HEIGHT);

        let i = 0; 

        for (let y=0; y<DEBUG_CANVAS_HEIGHT; y++) {
            for (let x=0; x<DEBUG_CANVAS_WIDTH; x++) {
                let newPoint = transfromMatrix.transformPoint(x,y);
                if (!blackAndWhite.isSet(newPoint[0]|0, newPoint[1]|0)) {
                    data[i] = 255;
                    data[i+1] = 255;
                    data[i+2] = 255;

                }
                data[i+3] = 255;

                i += 4;
            }
        }

        let imageData = new ImageData(data, DEBUG_CANVAS_WIDTH, DEBUG_CANVAS_HEIGHT);

        debugCtx.putImageData(imageData, 0, 0);

        console.log(transfromMatrix);
    }

    display(ctx) {
        ctx.strokeStyle = 'none';
        for (const target of this.aligners) {
            ctx.fillStyle = 'green';
            ctx.fillRect(
                blackAndWhite.width*target.left, 
                blackAndWhite.height*target.top, 
                blackAndWhite.width*(target.right-target.left), 
                blackAndWhite.height*(target.bottom-target.top)
            );

            ctx.fillStyle = 'blue';
            ctx.beginPath();
            ctx.ellipse(
                blackAndWhite.width*target.meanX, 
                blackAndWhite.height*target.meanY, 
            20, 20, 0, 0, 2*Math.PI);
            ctx.fill();
        }
    }
}

class HasSeen {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Uint8Array(width*height);
    }

    isSet(x, y) {
        return this.data[x + y*this.width];
    }

    set(x, y) {
        this.data[x + y*this.width] = 1;
    }
}


class BlackAndWhite {
    constructor(greyscale, theshhold) {
        const greyscaleData = greyscale.data;
        const newImageData = new Uint8ClampedArray(greyscaleData.length);

        for (let i=0; i<greyscaleData.length; i += 4) {

            // was zero
            if (greyscaleData[i/4] > theshhold) {
                newImageData[i] = 255;
                newImageData[i+1] = 255;
                newImageData[i+2] = 255;    
            }

            newImageData[i+3] = 255;
        }

        this.width = greyscale.width;
        this.height = greyscale.height;

        this.imageData = new ImageData(newImageData, greyscale.width, greyscale.height);
    }

    isSet(x, y) {
        return this.imageData.data[4*(x + y*this.width)] === 0;
    }

    drawOnContext(ctx) {
        ctx.putImageData(this.imageData, 0, 0);
    }
}

class Greyscale {
    constructor(old) {
        const oldData = old.data;
        const data = new Uint8ClampedArray(oldData.length);

        for (let i=0, j=0; i<oldData.length; i += 4, j++) {
            const min = Math.min(oldData[i], oldData[i+1], oldData[i+2])|0;
            const max = Math.max(oldData[i], oldData[i+1], oldData[i+2])|0;
            data[j] = (min + max)/2;
        }

        this.width = old.width;
        this.height = old.height;
        this.data = data;
    }
}

class Matrix {
    constructor(rows, width, height) {
        this.rows = rows;
        this.width = width;
        this.height = height;
    }

    static zeros(width, height) {
        const rows = [];
        for (let i=0; i<height; i++) {
            const row = [];
            for (let j=0; j<width; j++) row[j] = 0;
            rows.push(row);
        }
        return new Matrix(rows, width, height);
    }

    static identity(size) {
        const rows = [];
        for (let i=0; i<size; i++) {
            const row = [];
            for (let j=0; j<size; j++) row[j] = 0;
            row[i] = 1;
            rows.push(row);
        }
        return new Matrix(rows, size, size);
    }

    get(x, y) { return this.rows[y][x] }
    get1(x, y) { return this.rows[y-1][x-1] }

    set(x, y, value) { this.rows[y][x] = value }
    set1(x, y, value) { this.rows[y-1][x-1] = value } 

    swapRows(i, j) {
        const temp = JSON.parse(JSON.stringify(this.rows[j]));
        this.rows[j] = this.rows[i];
        this.rows[i] = temp;
    }
    swapRows1(i, j) {
        const temp = JSON.parse(JSON.stringify(this.rows[j-1]));
        this.rows[j-1] = this.rows[i-1];
        this.rows[i-1] = temp;
    }


    appendColumn(vector) {
        for (let i=0; i<this.height; i++) {
            this.rows[i].push(vector[i]);
        }
        this.width++;
    }

    augment(other) {
        for (let i=0; i<this.height; i++) {
            this.rows[i] = this.rows[i].concat(other.rows[i]);
        }
        this.width += other.width;
    }

    transformPoint(x, y) {
        // must be 3x3 matrix
        const m = this;
        const denom = m.get(0, 2)*x + m.get(1,2)*y + m.get(2,2);

        const newX = (m.get(0,0)*x + m.get(1,0)*y + m.get(2,0)) / denom;
        const newY = (m.get(0,1)*x + m.get(1,1)*y + m.get(2,1)) / denom;

        return [newX, newY];
    }

    invert() {
        const size = this.width;
        this.augment(Matrix.identity(size));

        for (let i=0; i<size; i++) {
            if (this.get(i, i) === 0) {
                throw "bad";
            }

            for (let j=0; j<size; j++) {
                if (i != j) {
                    let f = this.get(i, j) / this.get(i, i);
                    for (let k=0; k<2*size; k++) {
                        this.set(k, j, this.get(k, j) - f*this.get(k, i));
                    }
                }
            }
        }

        for (let i=0; i<size; i++) {
            let tmp = this.get(i, i);
            for (let j=0; j<2*size; j++) {
                this.set(j, i, this.get(j,i) / tmp);
            }
        }

        for (let j=0; j<size; j++) {
            this.rows[j] = this.rows[j].slice(size);
        }
    }

    solve(y) {
        const augmented = new Matrix(
            JSON.parse(JSON.stringify(this.rows)),
            this.width,
            this.height  
        );
        augmented.appendColumn(y);
        const m = augmented.height;

        for (let k=0; k<augmented.height; k++) {
            let iMax = k;
            let max = Math.abs(augmented.rows[iMax][k]);
            for (let i=k+1; i<m; i++) {
                let abs = Math.abs(augmented.rows[i][k]);
                if (abs > max) {
                    iMax = i;
                    max = abs;
                }
            }

            if (augmented.rows[iMax][k] === 0) {
                throw "boo";
            }

            augmented.swapRows(k, iMax);
            for (let i=k+1; i<m; i++) {
                let f = augmented.rows[i][k] / augmented.rows[k][k];
                for (let j=k+1; j<=m; j++) {
                    augmented.rows[i][j] -= augmented.rows[k][j]*f;
                }
                augmented.rows[i][k] = 0;
            }
        }

        let ret = [];
        for (let i=m-1; i>=0; i--) {
            ret[i] = augmented.rows[i][m];
            for (let j=i+1; j<m; j++) {
                ret[i] -= augmented.rows[i][j] * ret[j];
            }
            ret[i] /= augmented.rows[i][i];
        }

        return ret;
    }


    static fromPerspectiveTransform(src, dst) {
        // NOTICE:
        // I didn't come up with any of the code in this file. It is all taken from the getPerspectiveTransform and warpPerspective functions in
        // https://github.com/opencv/opencv
        // I didn't want to use opencv as a library dependancy because I didn't want to include their massive libary when I am only using two functions.
        // This is their copyright notice:

        // this is their copyright notice:

        ////////////////////////////////////////////////////////////////////////////////////////
        //
        //  IMPORTANT: READ BEFORE DOWNLOADING, COPYING, INSTALLING OR USING.
        //
        //  By downloading, copying, installing or using the software you agree to this license.
        //  If you do not agree to this license, do not download, install,
        //  copy or use the software.
        //
        //
        //                           License Agreement
        //                For Open Source Computer Vision Library
        //
        // Copyright (C) 2000-2008, Intel Corporation, all rights reserved.
        // Copyright (C) 2009, Willow Garage Inc., all rights reserved.
        // Copyright (C) 2014-2015, Itseez Inc., all rights reserved.
        // Third party copyrights are property of their respective owners.
        //
        // Redistribution and use in source and binary forms, with or without modification,
        // are permitted provided that the following conditions are met:
        //
        //   * Redistribution's of source code must retain the above copyright notice,
        //     this list of conditions and the following disclaimer.
        //
        //   * Redistribution's in binary form must reproduce the above copyright notice,
        //     this list of conditions and the following disclaimer in the documentation
        //     and/or other materials provided with the distribution.
        //
        //   * The name of the copyright holders may not be used to endorse or promote products
        //     derived from this software without specific prior written permission.
        //
        // This software is provided by the copyright holders and contributors "as is" and
        // any express or implied warranties, including, but not limited to, the implied
        // warranties of merchantability and fitness for a particular purpose are disclaimed.
        // In no event shall the Intel Corporation or contributors be liable for any direct,
        // indirect, incidental, special, exemplary, or consequential damages
        // (including, but not limited to, procurement of substitute goods or services;
        // loss of use, data, or profits; or business interruption) however caused
        // and on any theory of liability, whether in contract, strict liability,
        // or tort (including negligence or otherwise) arising in any way out of
        // the use of this software, even if advised of the possibility of such damage.
        ////////////////////////////////////////////////////////////////////////////////////////

        console.log(src);
        console.log(dst);

        const a = Matrix.zeros(8, 8);
        const b = []; // 8 long

        for (let i = 0; i < 4; i++) {
            a.set(3, i + 4, src[i][0]);
            a.set(0, i, src[i][0]);

            a.set(4, i + 4, src[i][1]);
            a.set(1, i, src[i][1]);

            a.set(5, i + 4, 1);
            a.set(2, i, 1);

            a.set(6, i, -src[i][0] * dst[i][0]);
            a.set(7, i, -src[i][1] * dst[i][0]);
            a.set(6, i + 4, -src[i][0] * dst[i][1]);
            a.set(7, i + 4, -src[i][1] * dst[i][1]);

            b[i] = dst[i][0];
            b[i + 4] = dst[i][1];
        }

        const solution = a.solve(b);

        const newMatrixData = [[], [], []]; // 3x3

        let index = 0;
        for (let j = 0; j < 3; j++) {
            for (let i = 0; i < 3; i++) {
                newMatrixData[j][i] = index===8? 1 : solution[index];
                index++;
            }
        }

        const newMatrix = new Matrix(newMatrixData, 3, 3);
        newMatrix.invert();

        return newMatrix;
    }
}

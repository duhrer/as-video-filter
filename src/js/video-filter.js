let inputPicker = document.getElementById("input-picker");

let videoElement = document.getElementById("video");
let videoWidth = 640;
let videoHeight = 480;

let visibleCanvasElement = document.getElementById("visible-canvas");
let visibleCanvasContext = visibleCanvasElement.getContext('2d');

let hiddenCanvasContext;

let filterPicker = document.getElementById("filter-picker");
filterPicker.addEventListener("change", pickFilter);

let fpsContainer = document.querySelector('.fps');
let fpsCounter = document.getElementById('fps-counter');

let rafRequestId = false;

let currentFilter = false;

let exports, memory;
instantiateWasm();

// Get the list of all available video devices so we can create an input picker.
let getUserMediaPromise = navigator.mediaDevices.getUserMedia({ video: true });
getUserMediaPromise.then(createInputPicker);
getUserMediaPromise.catch(function (error) {
    console.error(error);
});

function pickFilter () {
    var filterKey = filterPicker.value;

    if (availableFilters[filterKey]) {
        currentFilter = availableFilters[filterKey];
    }
    else {
        currentFilter = false;
    }
}

function playSelectedInput (stream) {
    const track = stream.getTracks()[0];
    const trackSettings = track.getSettings();
    videoWidth = trackSettings.width;
    videoHeight = trackSettings.height;

    videoElement.srcObject = stream;
    videoElement.onloadedmetadata = function () {
        video.play();

        videoWidth = video.videoWidth;
        videoHeight = video.videoHeight;

        // Set up a (noticeably faster) offscreen canvas instead of drawing to
        // a hidden one in the actual DOM.
        let offscreenCanvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        
        hiddenCanvasContext = offscreenCanvas.getContext('2d', { willReadFrequently: true });


        // Resize the visible canvas to match the video.
        visibleCanvasElement.setAttribute("width", videoWidth);
        visibleCanvasElement.setAttribute("height", videoHeight);

        exports.setDimensions(videoWidth, videoHeight);

        // Display the FPS stats
        fpsContainer.classList.remove("hidden");

        startPolling();
    };
}

function createInputPicker () {
    // TODO: Wire up list of video inputs.
    navigator.mediaDevices.enumerateDevices().then( function (devices) {
        let listHtml = "<option value='-1'>None</option>";

        // Populate the unordered list used to pick our input.
        devices.forEach(function (device) {
            if (device.kind === "videoinput") {
                listHtml += "<option value='" + device.deviceId + "'>" + device.label + "</option>\n"
            }
        })

        inputPicker.innerHTML = listHtml;
        inputPicker.addEventListener("change", selectVideoInput);
    });
}

function selectVideoInput (event) {
    stopPolling();

    var inputId = inputPicker.value;
    if (inputId === "-1") {
        videoElement.srcObject = undefined;
        visibleCanvasContext.clearRect(0, 0, videoWidth, videoHeight);

        // Hide the FPS stats
        fpsContainer.classList.add("hidden");
    }
    else {
        // Targeted pass gets us a specific input.
        let constraints = {
            video: {
                deviceId: {
                    exact: inputId
                },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };
        navigator.mediaDevices.getUserMedia(constraints).then(playSelectedInput);
    }
}

function stopPolling() {
    if (rafRequestId) {
        window.cancelAnimationFrame(rafRequestId);
        rafRequestId = false;
    }
}

function startPolling() {
    rafRequestId = window.requestAnimationFrame(processSingleFrame);
}

let fpsData = [];

function processSingleFrame () {
    if (hiddenCanvasContext) {
        hiddenCanvasContext.drawImage(videoElement, 0, 0);
        const imageData = hiddenCanvasContext.getImageData(0, 0, videoWidth, videoHeight);

        if (currentFilter) {
            currentFilter(imageData);
        }
        // TODO: Pass the image data through to WASM and process it there.

        visibleCanvasContext.putImageData(imageData, 0, 0);

        fpsData.push(Date.now());
        if (fpsData.length === 10) {
            let tenFrameMs = fpsData[9] - fpsData[0]; // ms / ten frames
            let avgFrameMs = tenFrameMs / 10;
            let fps = Math.round (1000/avgFrameMs);

            fpsCounter.innerText = fps;
            
            fpsData = [];
        }

        // Tee up the next iteration
        rafRequestId = window.requestAnimationFrame(processSingleFrame);
    }
}

// Filters


// Approximate scanlines and gaps on a CRT by creating 240 vertical
// bands of darkness.
function jsScanLines (imageData) {
    let bandHeight = videoHeight / 480;
    for (let band = 0; band < 480; band += 2) {
        let approximateRow = band * bandHeight;
        let closestExactRow = Math.round(approximateRow);
        let startIndex = closestExactRow * videoWidth * 4;
        for (let colOffset = 0; colOffset < videoWidth * 4; colOffset += 4) {
            imageData.data.set([0,0,0,255], startIndex + colOffset);
        }

        if (approximateRow !== closestExactRow) {
            let bandOverlapPercent = closestExactRow < approximateRow ? approximateRow - closestExactRow : closestExactRow - approximateRow;
            let adjacentRow = closestExactRow < approximateRow ? closestExactRow + 1 : closestExactRow - 1;

            if (adjacentRow > 0 && adjacentRow < videoHeight) {
                let startIndex = adjacentRow * videoWidth * 4;
                for (let colOffset = 0; colOffset < videoWidth * 4; colOffset += 4) {
                    imageData.data[startIndex + colOffset] = Math.round(imageData.data[startIndex + colOffset] * (1 - bandOverlapPercent));
                    imageData.data[startIndex + colOffset + 1] = Math.round(imageData.data[startIndex + colOffset + 1] * (1 - bandOverlapPercent));
                    imageData.data[startIndex + colOffset + 2] = Math.round(imageData.data[startIndex + colOffset + 2] * (1 - bandOverlapPercent));
                }
            }
        }
    }
}

// Crude simulation of vertical hold issues.
let verticalOffset = 0;
// TODO: Make the speed and direction configurable
let verticalHoldDelta = -15;

function jsVerticalHold (imageData) {
    // Simulate a black band at the edges, like an old CRT.
    let blackBand = new Uint8ClampedArray(videoWidth * 4 * 5);
    let blackPixel = [0,0,0,255];
    for (let a = 0; a < blackBand.length; a += 4) {
        blackBand.set(blackPixel, a);
    }

    imageData.data.set(blackBand);
    imageData.data.set(blackBand, imageData.data.length - blackBand.length);

    verticalOffset = (videoHeight + verticalOffset + verticalHoldDelta) % videoHeight;

    if (verticalOffset) {
        let sliceIndex = verticalOffset * videoWidth * 4;
        let firstSlice = imageData.data.slice(0, sliceIndex);
        let secondSlice = imageData.data.slice(sliceIndex);

        imageData.data.set(secondSlice);
        imageData.data.set(firstSlice, secondSlice.length);
    }
}

// Simple test of chaining filters.
function jsVerticalHoldAndScanLines (imageData) {
    jsVerticalHold(imageData);
    jsScanLines(imageData);
}

// TODO: Wire up listener for device disconnection?


function generateWasmWrapper (fnName) {
    return function (imageData) {
        if (exports && fnName && exports[fnName] && memory) {
            // TODO: Consider how best to instantiate this, as the working dimensions may change.
            const wasmByteMemoryArray = new Uint8Array(memory.buffer);

            // Write image data to shared buffer
            wasmByteMemoryArray.set(imageData.data);

            // Call WASM function
            exports[fnName]();

            // TODO: Manage this somewhere else.
            let bytesToSet = videoHeight * videoWidth * 4;

            // Write updated data back to image data.
            imageData.data.set(wasmByteMemoryArray.slice(0, bytesToSet));
        }
    } 
}

let asScanlines = generateWasmWrapper('addScanLines');

let asVerticalHold = generateWasmWrapper('applyVerticalHold');

let asCombineWithRotatedSelf = generateWasmWrapper('combineWithRotatedSelf');

let asCombineWithMirroredSelf = generateWasmWrapper('combineWithMirroredSelf');

function asChainedKaleidoscope (imageData) {
    asCombineWithRotatedSelf(imageData);
    asCombineWithMirroredSelf(imageData);
}

// Utility function to load WASM, adapted from:
// https://github.com/torch2424/wasm-by-example/blob/master/demo-util/instantiateWasm.js
// https://github.com/torch2424/wasm-by-example/blob/master/examples/reading-and-writing-graphics/demo/assemblyscript/index.js

async function instantiateWasm () {
    // TODO: Make this configurable?
    //const url = './build/debug.wasm';
    const url = './build/release.wasm';
    const importObject = {
        env: {
            abort: () => { console.error("WASM load aborted.");}
        }
    }

    if (!WebAssembly.instantiateStreaming) {
        throw(new Error("Can't instantiate WASM, no streaming instantiation available."));
    }

    let wasmModule = await WebAssembly.instantiateStreaming(
        fetch(url),
        importObject
    );

    exports = wasmModule.instance.exports;
    memory = wasmModule.instance.exports.memory;
}

const availableFilters = {
    jsScanlines: jsScanLines,
    jsVerticalHold: jsVerticalHold,
    jsVerticalHoldAndScanLines: jsVerticalHoldAndScanLines,
    asScanlines: asScanlines,
    asVerticalHold: asVerticalHold,
    asCombineWithRotatedSelf: asCombineWithRotatedSelf,
    asCombineWithMirroredSelf: asCombineWithMirroredSelf,
    asChainedKaleidoscope: asChainedKaleidoscope
};
// TODO: Create a project that uses (p)react and typescript.
/*
    TODO: Import video processing bits.
    import { add } from "./build/release.js";
*/

let inputPicker = document.getElementById("input-picker");

let videoElement = document.getElementById("video");
let videoWidth = 640;
let videoHeight = 480;

let visibleCanvasElement = document.getElementById("visible-canvas");
let visibleCanvasContext = visibleCanvasElement.getContext('2d');

let hiddenCanvasContext;

// First pass gets use the list of video devices.
let getUserMediaPromise = navigator.mediaDevices.getUserMedia({ video: true });
getUserMediaPromise.then(createInputPicker);

let rafRequestId = false;

/*

    Some approaches using media stream track procssing and web codecs, which is
    not well documented, and which is not supported in Firefox.

*/

/*

    This approach uses window.createImageBitmap and MediaStreamTrackProcessor
    to process video frames, but this is miserably slow, like a frame every few
    seconds if that.

*/
// function playSelectedInput (stream) {
//     let track = stream.getTracks()[0];
//     let processor = new MediaStreamTrackProcessor(track);

//     let buffer;

//     let outputStream = new WritableStream({
//         // Adapted from https://github.com/mganeko/videotrackreader_demo/blob/main/mediastreamtrackprocessor.html
//         async write(videoFrame) {
//             const bitmap = await window.createImageBitmap(videoFrame);
//             canvasContext.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, canvasElement.width, canvasElement.height);
//             bitmap.close();
//         }        
//     });

//     processor.readable.pipeTo(outputStream);
// }

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

function processSingleFrame () {
    if (hiddenCanvasContext) {
        hiddenCanvasContext.drawImage(videoElement, 0, 0);
        const imageData = hiddenCanvasContext.getImageData(0, 0, videoWidth, videoHeight);
    
        // TODO: Pass the image data through to WASM and process it there.

        // Approximate scanlines and gaps on a CRT by creating 240 vertical
        // bands of darkness.
        
        let bandHeight = videoHeight / 480;
        for (let band = 0; band < 480; band += 2) {
            let approximateRow = band * bandHeight;
            let closestExactRow = Math.round(approximateRow);
            let startIndex = closestExactRow * videoWidth * 4;
            for (let colOffset = 0; colOffset < videoWidth * 4; colOffset += 4) {
                // Just set the alpha to 0
                imageData.data[startIndex + colOffset] = 0;
                imageData.data[startIndex + colOffset + 1] = 0;
                imageData.data[startIndex + colOffset + 2] = 0;
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

        visibleCanvasContext.putImageData(imageData, 0, 0);
    
        // Tee up the next iteration
        rafRequestId = window.requestAnimationFrame(processSingleFrame);
    }
}

// TODO: Wire up listener for device disconnection?


// TODO: Pass video stream through WASM function to transform it.

// TODO: Create a project that uses (p)react and typescript.
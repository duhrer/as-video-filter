// As we cannot shrink memory, we have to hard-code our minimum and maximum
// memory size and manage calls to grow as needed.

const MIN_WIDTH: i32 = 640;
const MIN_HEIGHT: i32 = 480;

const MAX_WIDTH: i32 = 1920;
const MAX_HEIGHT: i32 = 1080;

let width = 0;
let height = 0;

export const IMAGE_BUFFER_POINTER: i32 = 0;
let IMAGE_BUFFER_SIZE: i32 = 0;

export function setDimensions(newWidth: i32, newHeight: i32) : void {
  // TODO: Throw and error if the dimension are too small.
  // As we are dealing with RGBA data, we request height * width * 4 bytes
  // (plus one page for housekeeping). One page is 64 Kb.
  let newImageBufferSize = (newHeight * newWidth * 4);
  let pagesRequired = ((newHeight * newWidth * 4) / (64 * 1024)) + 10; // TODO: Try taking the cheat room off.
  if (memory.size() < pagesRequired) {
    let oldPageCount = memory.grow(pagesRequired);
    // A return value of -1 indicates that memory could not be resized to
    // the requested value, See:
    // https://www.assemblyscript.org/stdlib/globals.html#memory
    if (oldPageCount === -1) {
      // TODO: Learn about error handling and report the error here.
    }
    else {
      width = newWidth;
      height = newHeight;
      IMAGE_BUFFER_SIZE = newImageBufferSize;
    }
  }
  else {
    width = newWidth;
    height = newHeight;
    IMAGE_BUFFER_SIZE = newImageBufferSize;
  }
}

// Call setDimensions with the defaults on startup.
setDimensions(MIN_WIDTH, MIN_HEIGHT);

// Utility functions.
function writePixel (startIndex: i32, rValue: u8, gValue: u8, bValue: u8, aValue: u8) :void {
  store<u8>(startIndex, rValue);
  store<u8>(startIndex + 1, gValue);
  store<u8>(startIndex + 2, bValue);
  store<u8>(startIndex + 3, aValue);
}

function writePixelArray (startIndex: i32, values: Array<u8>): void {
  writePixel(startIndex, values[0], values[1], values[2], values[3]);
}

// Fails when creating new array with "index out of bounds" malarky.
function readPixelArray (startIndex: i32): Array<u8> {
  let pixelArray = new Array<u8>(4);
  for (let a = 0; a < 4; a++) {
    let value = load<u8>(startIndex + a);
    pixelArray[a] = value;
  }
  return pixelArray;
}

// Image processing functions.
// These assume the Javascript portion of the code has already copied the
// required image data into shared memory.

export function addScanLines() :void {
  if (height < 480) {
      return;
  }

  let bandHeight: f32 = <f32>height / 480;

  for (let band: i32 = 0; band < 480; band += 2) {
    let approximateRow = <f32>band * bandHeight;
    let closestExactRow: i32 = <i32>approximateRow;
    let startIndex: i32 = IMAGE_BUFFER_POINTER + (closestExactRow * width * 4);
    for (let colOffset: i32 = 0; colOffset < width * 4; colOffset += 4) {
      writePixel(startIndex + colOffset, 0, 0, 0, 255);
    }
  }
}

/*

  Left in as a reference.  Pitifully slow, 7-9 FPS with this approach.

  All attempts to store and shift part of the data in an array result in
  "index out of bounds" errors.

*/

// Crude simulation of vertical hold issues.
let verticalOffset: i32 = 0;
// TODO: Make the speed and direction configurable
let verticalHoldDelta: i32 = -15;

// Apply a simulated shift in vertical hold a single column at a time.
// Went down that road because of the issues creating arrays to temporarily
// hold one piece of the image that will be overwritten.  Laughably slow.
export function applyVerticalHold () :void {
  verticalOffset = (height + verticalOffset + verticalHoldDelta) % height;

  if (verticalOffset) {
    for (let x: i32 = 0; x < (width * 4); x++) {
      // Throws an index out of bounds error.
      //let firstSlice = new Array<u8>(verticalOffset);
      for (let y: i32 = 0; y < height; y++) {
        let currentIndex = IMAGE_BUFFER_POINTER + x + (y * width * 4);
        if (y < (height - verticalOffset)) {
          // Top slice, store the values we will overwrite
          if (y < verticalOffset) {
            //let foo = load<u8>(currentIndex);

            //firstSlice[y] = load<u8>(currentIndex);
          }

          let toShiftIndex = currentIndex + (verticalOffset * width * 4);
          let toShiftValue = load<u8>(toShiftIndex);
          store<u8>(currentIndex, toShiftValue);
        }
        // Bottom slice, where we write the stored values.
        else {
          //let firstSliceIndex = y - verticalOffset;
          //store<u8>(currentIndex, firstSlice[firstSliceIndex]);
          store<u8>(currentIndex, 0);
        }
      }
    }
  }
}

function averageArrays (array1: Array<u8>, array2: Array<u8>): Array<u8> {
  let combinedArray = new Array<u8>(array1.length);
  for (let index = 0; index < array1.length; index++) {
    let average: u8 = <u8>((array1[index] + array2[index]) / 2);
    combinedArray[index] = average;
  }
  return combinedArray;
}

// Combine an image with itself, rotated 180 degrees.
export function combineWithRotatedSelf () :void {
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height / 2; y++) {
      let pixelOneIndex = IMAGE_BUFFER_POINTER + (y * width * 4) + (x * 4);
      let pixelTwoIndex = IMAGE_BUFFER_POINTER + ((height - y) * width * 4) + ((width - x) * 4);

      let pixelOneRValue = load<u8>(pixelOneIndex);
      let pixelOneGValue = load<u8>(pixelOneIndex + 1);
      let pixelOneBValue = load<u8>(pixelOneIndex + 2);
      let pixelOneAValue = load<u8>(pixelOneIndex + 3);

      let pixelTwoRValue = load<u8>(pixelTwoIndex);
      let pixelTwoGValue = load<u8>(pixelTwoIndex + 1);
      let pixelTwoBValue = load<u8>(pixelTwoIndex + 2);
      let pixelTwoAValue = load<u8>(pixelTwoIndex + 3);

      let maxRValue = <u8>Math.max(pixelOneRValue, pixelTwoRValue);
      let maxGValue = <u8>Math.max(pixelOneGValue, pixelTwoGValue);
      let maxBValue = <u8>Math.max(pixelOneBValue, pixelTwoBValue);
      let maxAValue = <u8>Math.max(pixelOneAValue, pixelTwoAValue);

      writePixel(pixelOneIndex, maxRValue, maxGValue, maxBValue, maxAValue);
      writePixel(pixelTwoIndex, maxRValue, maxGValue, maxBValue, maxAValue);
    }
  }
}

export function combineWithMirroredSelf () :void {
  for (let x = 0; x < width / 2; x++) {
    for (let y = 0; y < height; y++) {
      let pixelOneIndex = IMAGE_BUFFER_POINTER + (y * width * 4) + (x * 4);
      let pixelTwoIndex = IMAGE_BUFFER_POINTER + (y * width * 4) + ((width - x) * 4);

      let pixelOneRValue = load<u8>(pixelOneIndex);
      let pixelOneGValue = load<u8>(pixelOneIndex + 1);
      let pixelOneBValue = load<u8>(pixelOneIndex + 2);
      let pixelOneAValue = load<u8>(pixelOneIndex + 3);

      let pixelTwoRValue = load<u8>(pixelTwoIndex);
      let pixelTwoGValue = load<u8>(pixelTwoIndex + 1);
      let pixelTwoBValue = load<u8>(pixelTwoIndex + 2);
      let pixelTwoAValue = load<u8>(pixelTwoIndex + 3);

      let maxRValue = <u8>Math.max(pixelOneRValue, pixelTwoRValue);
      let maxGValue = <u8>Math.max(pixelOneGValue, pixelTwoGValue);
      let maxBValue = <u8>Math.max(pixelOneBValue, pixelTwoBValue);
      let maxAValue = <u8>Math.max(pixelOneAValue, pixelTwoAValue);

      writePixel(pixelOneIndex, maxRValue, maxGValue, maxBValue, maxAValue);
      writePixel(pixelTwoIndex, maxRValue, maxGValue, maxBValue, maxAValue);
    }
  }
}

// TODO: function to combine an image with its "mirror".  Look at each pixel
// and its "partner" at the other end of the row.

// TODO: Combine both to make a "kaleidescope".
 
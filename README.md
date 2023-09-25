# AssemblyScript Video Filters

I created this repository to experiment with creating video filters that can
process video in real time, and which also can be configured in real time.  The
idea is to test the viability of Javascript and Web Assembly to create
reactive videos or video filters.

# Try It Yourself

To try this out locally, you will node@18 or higher:

1. Check out the repository.
2. Install all required dependencies using a command like `npm install`
3. Build the WASM modules using the command `npm asbuild`
4. Start the local server using the command `npm start`
5. Open the hostname and port that appear in the prompt in your browser (the work here has been informally tested with FireFox, Safari, and Chrome derivatives).

The Web Assembly portions of the code are written using [AssemblyScript](https://www.assemblyscript.org/), which
provides the `asbuild` and `start` commands as part of its `asinit` setup
script. 

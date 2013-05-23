//TODO put all in GIFLAB namespace
//TODO implement interlace
//TODO handle left,top offsets

var timer;
function DeltaTimer() {
  this.now = function() {
    return (new Date).getTime();
  }
  
  this.last = this.now();
  
  this.next = function(msg) {
    var now = this.now();
    var dt = now - this.last;
    this.last = now;
    
    console.log(now + " :: " + dt + " :: " + msg);
  }
}

function l(t) {
  //console.log(t);
}

/* Hack function to pad a hex digit */
function padhex(s) {
  return (s.length == 1) ? "0"+s : s;
}
 
/* the upload.php iframe calls this function1!!!
 *
 * You can't do file uploads w/ AJAX, so you POST
 * to an iframe and it sends the data back.
 */
var imgcount=0;
function filedata_receiver(res) {
  if (res['error']) {
    alert("Bad news: " + res['error']);
    return;
  }
  
  timer = new DeltaTimer();
  timer.next("--Init");
  //var data = decode_base64(res['data']);
  var data = atob(res['data']);
  timer.next("--Decode base-64");
  var gif = new GIF(data);
  timer.next("--Processing");
  //console.dir(gif);
  if (document.getElementById("render-table").checked) {
    renderTable("gif"+imgcount, gif);
  } else {
    renderCanvas("gif"+imgcount, gif);
  }
  imgcount++;
  timer.next("--Rendering");
}

/* Takes an 8-bit int, extracts the bits from
 * s to e (0-based, inclusive) and returns the value.
 * Bits are numbered as: 7 6 5 4 3 2 1 0 (TODO fix that)
 */
function bits(n, s, e) {
  e = e > 7 ? 7 : e;
  var masks = [0x01, 0x03, 0x07, 0x0F, 0x1F, 0x3F, 0x7F, 0xFF];
  //return (n >> (7 - e)) & masks[e - s];
  return (n >> s) & masks[e - s];
}

/* 3 bits from one byte, 5 from the next. Recombine them! */
function recombine(x, y, x_bits) {
  return (y << x_bits) | x;
}

/**
 * GIF object.
 * `data` is a string of binary data.
 * Once complete, you can access the output for any frame, i, through `gifObj.images[i].output`.
 */
function GIF (data) {
  this.width = 0;
  this.height = 0;
  this.num_colors = 0;
  this.animated = false;
  this.images = [];
  
  // ints will be easier to work with than chars. Go ahead and convert now.
  this._data = [];
  for (var i = 0, max = data.length; i < max; i++) {
    this._data[i] = data.charCodeAt(i);
  }
  this._n = 0; // keeps track of where we are in the file
  this._has_gct = false;
  this._sz_gct = 0; // size of the global color table
  this._gct = []; // global color table - an array of #RRGGBB strings
  this._gce = {}; // Graphics Control Extension data. Changes each frame -- beware!
  this._img = 0; // for keeping track of what frame we're on
  
  /**
   * Begin processing the GIF!
   *
   * The state machine here comes straight from "Appendix B. GIF Grammar" in the spec.
   * <http://tronche.com/computer-graphics/gif/gif89a.html#grammar>
   */
  this._read_header();
  this._read_logical_screen_descriptor();
  this._read_global_color_table();
  
  while (this._data[this._n] != 0x3B) { // until we hit the trailer byte
    if (this._data[this._n] == 0x21 && this._data[this._n + 1] == 0xFF) { // application extension
      this._read_app_ext();
    } else if (this._data[this._n] == 0x21 && this._data[this._n + 1] == 0xFE) { // comment extension
      this._read_comment_ext();
    } else { // an actual image! (unless this file is goofy and has a plain text ext)
      this._read_graphics_control_ext();
      if (this._data[this._n] == 0x21 && this._data[this._n + 1] == 0x01) { // plain text extension
        this._read_plain_text_extension();
      } else {
        this._read_image_descriptor();
        this._read_local_color_table(); // if exists
        this._read_image_data();
        this._img++;
      }
    }
  }
}

GIF.prototype._read_header = function() {
  // Just assume it's "GIF89a" and skip over.
  this._n = 6;
};

/** LOGICAL SCREEN DESCRIPTOR **/
GIF.prototype._read_logical_screen_descriptor = function() {
  /* Bytes 6-9 - width and height */
  this.width = (this._data[7] << 8) | this._data[6];
  this.height = (this._data[9] << 8) | this._data[8];

  /* Byte 10 - Packed byte */
  var iii = this._data[10];
  var has_gct = (iii >> 7) & 0x01; // usually 1
  var col_res = (iii >> 4) & 0x07; // usually 001
  var sort_flag = (iii >> 3) & 0x01; // is gct sorted by freq?
  var sz_gct = iii & 0x07;  // 2^(sz_gct + 1) is # entries
  
  /* Byte 11 - background color index */
  var bgcolor_index = 0; // pixels w/o values specified use the value at this index in the GCT. Spec says default is 0.
  bgcolor_index = this._data[11];
  // just what is a "pixel without a value"?
  
  /* Byte 12 - pixel aspect ratio */
  var pixel_aspect_ratio = this._data[12]; // more weird shit - not used
  
  this._has_gct = has_gct;
  this._sz_gct = sz_gct;
  this._n = 13; // prepare for next section
};

/** GLOBAL COLOR TABLE (Optional, but usually present) **/
GIF.prototype._read_global_color_table = function() {
  if (! this._has_gct) {
    return;
  }
  
  // ARE YOU READY FOR SOME FOOTBALL?!?!!
  var num_colors = Math.pow(2, this._sz_gct + 1);
  var i = 0;
  while (i < num_colors) {
    this._gct[i] = "#" + padhex(this._data[this._n].toString(16)) + padhex(this._data[this._n + 1].toString(16)) + padhex(this._data[this._n + 2].toString(16));
    this._n += 3;
    i += 1;
  }
  
  this.num_colors = num_colors;
}

/** GRAPHICS CONTROL EXTENSION (Optional) */
GIF.prototype._read_graphics_control_ext = function() {
  // Set some default values
  this._gce = {
    block_size: 4,
    disposal_method: 0,
    user_input_flag: 0,
    xp_color_flag: 0,
    delay_time: 10,
    xp_color_index: 0
  };
  
  // 21 tells you it's an extension block; F9 tells you it's the GCE
  if (this._data[this._n] == 0x21 && this._data[this._n + 1] == 0xF9) {
    this._gce.block_size = this._data[this._n + 2]; // seems to always be 4?
    this._gce.disposal_method = (this._data[this._n + 3] >> 2) & 0x07; // not implemented
    this._gce.user_input_flag = (this._data[this._n + 3] >> 1) & 0x01; // dumb
    this._gce.xp_color_flag = this._data[this._n + 3] & 0x01; // is transparency used?
    this._gce.delay_time = (this._data[this._n + 5] << 8) | this._data[this._n + 4]; // in hundredths of a second
    this._gce.xp_color_index = this._data[this._n + 6]; // index in GCT to use for transparency
    //note: this._n+7 is the block terminator, 00.
    
    if (this._gce.xp_color_flag) {
      this._gct[this._gce.xp_color_index] = "transparent";
    }
    
    //hack
    if (this._gce.delay_time == 0) {
      this._gce.delay_time = 10;
    }
    
    this._n += 8; // finished with GCE; seek to next block
  }
}

/** IMAGE DESCRIPTOR **/
GIF.prototype._read_image_descriptor = function() {
  // Ten bytes
  var last_byte = this._data[this._n + 9];
  this.images[this._img] = {
    // byte 1 is image separator - skip
    left: (this._data[this._n + 2] << 8) | this._data[this._n + 1], // bytes 1-2
    top: (this._data[this._n + 4] << 8) | this._data[this._n + 3], // bytes 3-4
    width: (this._data[this._n + 6] << 8) | this._data[this._n + 5], // bytes 5-6
    height: (this._data[this._n + 8] << 8) | this._data[this._n + 7], // bytes 7-8
    gce: this._gce,
    has_lct: (last_byte >> 7) & 0x01, // first bit - local color table flag
    lct: [],
    interlace: (last_byte >> 6) & 0x01, // second bit - interlace (not implemented)
    sort_flag: (last_byte >> 5) & 0x01,
    lct_sz: last_byte & 0x07, // 2^(lct_sz + 1) is actual # of entries
    output: [] // literal array of #RRGGBB output
  };

  this._n += 10; // finished reading image descriptor
}

/** LOCAL COLOR TABLE (Optional) **/
GIF.prototype._read_local_color_table = function() {
  if (this.images[this._img].has_lct) {
    // TODO implement
  }
}

/** IMAGE DATA (whoop, there it is!) **/
GIF.prototype._read_image_data = function() {
  timer.next("-Started reading image data");
  var min_code_size = this._data[this._n];
  
  this._n++;
  
  l(this._img);
  this.images[this._img].min_code_size = min_code_size; // first byte is min code size
  var code_bits, shift_point; // initialized in clear_table()
  
  var code_table = [], CLEAR_CODE, EOI_CODE;
  var code_stream = [];
  var index_stream = [];
  
  var that = this;
  function clear_table() {
    code_bits = min_code_size + 1; // size in bits
    shift_point = Math.pow(2, code_bits) - 1; // when we add this index to code table, sets bits := bits + 1
    code_table.length = 0; // clear the array
    code_stream.length = 0; // clear the array
    for (var ct_index = 0; ct_index < that.num_colors; ct_index++) {
      code_table[ct_index] = [ct_index];
    }
    CLEAR_CODE = ct_index;
    code_table[ct_index] = CLEAR_CODE;
    EOI_CODE = ct_index + 1;
    code_table[ct_index + 1] = EOI_CODE;
  }
  clear_table();
  
  timer.next("Built code table");
  
  // read block after block
  // right now n should point at byte giving first block's length
  var image_data = [];
  while (true) {
    var num_bytes = this._data[this._n];
    this._n++;
    if (num_bytes == 0) {
      break;
    }
    while (num_bytes--) {
      image_data.push(this._data[this._n]);
      this._n++;
    }
  }
  timer.next("Read in all image data");
  
  // at this point, image_data should have a list of 8-bit integers representing ALL the image this._data
  // here, we start decoding the flexible byte stream, and doing LZW decompression
  var x = 0,
      image_data_len = image_data.length,
      code = null,
      rem = 0;
  while (x < image_data_len) {
    var k = 0; // k always refers to the starting point of the next bit block
    while (k < 8) {
      if (rem != 0) { // some left-over business
        var frag2 = bits(image_data[x], 0, rem - 1);
        code = recombine(code, frag2, code_bits - rem);
        k = rem;
        rem = 0;
      } else {
        code = bits(image_data[x], k, k + code_bits - 1);
        k += code_bits;
      }
      
      // here: handle clear code OR insert into table, output index stream etc.
      // if k > 8, we don't have a complete code yet, so hold back on this step.
      if (k <= 8) {
        if (code == CLEAR_CODE) {
          clear_table();
        } else {
          code_stream.push(code);
          
          if (code_table[code]) {
            for (var i = 0, max = code_table[code].length; i < max; i++) { // write to output stream
              var v = code_table[code][i];
              this.images[this._img].output.push(this.images[this._img].has_lct ? this.images[this._img].lct[v] : this._gct[v]);
            }
            if (code_stream.length >= 2) {
              // last code table value plus first character of this code table value
              try { // one gif tried to ref. a code that wasn't in the table yet
                code_table.push(code_table[code_stream[code_stream.length - 2]].concat(code_table[code][0]));
              } catch(e) {}
            }
          } else {
            try {
              var last_code = code_stream[code_stream.length - 2];
              var entry = code_table[last_code].concat(code_table[last_code][0]);
              for (var i = 0, max = entry.length; i < max; i++) { // write to output stream
                this.images[this._img].output.push(this.images[this._img].has_lct ? this.images[this._img].lct[entry[i]] : this._gct[entry[i]]);
              }
              code_table.push(entry);
            } catch(e) {}
          }
          
          /* Note that the spec says we should never shift over to 13 bits even if the table
           * is full. Instead stay at 12 and wait for a clear code. */
          if (code_bits < 12 && code_table.length == shift_point+1) { // time to increase bits-per-code
            code_bits++;
            shift_point = Math.pow(2, code_bits) - 1;
            //l("Code bits shifted to " + code_bits + ". Next shift point is " + shift_point);
          }
        }
      }
      
    }
    
    if (k > 8) { // note remainder for next byte
      rem = k - 8;
    }
    
    x++;
  }
  
  timer.next("LWZ Decompression");
}

/**
 * Helper function. Simply skips over all bytes in a section w/o doing anything.
 *
 * Note: This function expects n to point to the byte holding the first sub-block's length!
 */
GIF.prototype._skip_all_subblocks = function() {
  while (true) { // keep reading data sub-blocks until we've skipped them all
    var bytes = this._data[this._n]; // # of bytes in this block
    this._n++;
    if (bytes == 0) {
      break;
    }
    while (bytes--) { // seek to byte count of next block
      this._n++;
    }
  }
}
    
/* Stupid and never used */
GIF.prototype._read_plain_text_ext = function() {
  // Nothing uses this extension, so skip over it.
  if (this._data[this._n] == 0x21 && this._data[this._n + 1] == 0x01) {
    this._n += 2;
    this._skip_all_subblocks();
  }
}

/**
 * Doc indicates it may be used to specify that the GIF should loop?
 * If so, this is a TODO. For now, skip over.
 */
GIF.prototype._read_app_ext = function() {
  // Nothing uses this extension, so skip over it.
  if (this._data[this._n] == 0x21 && this._data[this._n + 1] == 0xFF) {
    this._n += 2;
    this._skip_all_subblocks();
  }
}

/* Non-printable data */
GIF.prototype._read_comment_ext = function() {
  // Nothing uses this extension, so skip over it.
  if (this._data[this._n] == 0x21 && this._data[this._n + 1] == 0xFE) {
    this._n += 2;
    this._skip_all_subblocks();
  }
}

/**
 * animFn will be given two parameters, n and last, which you can use to decide how to
 * render the transition between the two frames.
 */
function animateGif(gifObj, animFn) {
  function _animateGif(n) {
    var last = (n == 0) ? gifObj.images.length - 1 : n - 1;
    animFn(last, n);
    setTimeout(function() { _animateGif((n + 1) % gifObj.images.length); }, 10 * gifObj.images[n].gce.delay_time);
  }
  
  _animateGif(0);
}

function renderTable(divId, gifObj) {
  var gifDiv = document.createElement("div");
  gifDiv.id = divId; // unique ID
  for (var n = 0; n < gifObj.images.length; n++) {
    var frameDiv = document.createElement("div");
    frameDiv.id = divId+"_"+n;
    if (gifObj.images.length > 1) {
      frameDiv.style.display = "none"; // prepare for animation
    }
    
    var table = document.createElement("table");
    table.cellSpacing = 0;
    table.style.width = gifObj.images[n].width + "px";
    table.style.height = gifObj.images[n].height + "px";
    table.appendChild(document.createElement("thead"));
    table.appendChild(document.createElement("tbody"));
    
    var cells = gifObj.images[n].output.length;
    var t_row;
    var i = 0;
    while (i < cells) {
      if (i % gifObj.images[n].width == 0) {
        t_row = table.tBodies[0].appendChild(document.createElement("tr"));
      }
      var t_col = t_row.appendChild(document.createElement("td"));
      t_col.style.width = "1px";
      t_col.style.height = "1px";
      t_col.style.padding = "0px";
      t_col.style.backgroundColor = gifObj.images[n].output[i];
      
      i++;
    }
    
    frameDiv.appendChild(table);
    gifDiv.appendChild(frameDiv);
  }
  document.body.appendChild(gifDiv);
  
  if (gifObj.images.length > 1) {
    animateGif(gifObj, function(last, n) {
      document.getElementById(divId+"_"+last).style.display = "none";
      document.getElementById(divId+"_"+n).style.display = "block";
    });
  }
}

function renderDivs(divId, gifObj) {
}

function renderCanvas(divId, gifObj) {
  var gifDiv = document.createElement("div");
  gifDiv.id = divId;
  var canvas = document.createElement("canvas");
  canvas.setAttribute("width", gifObj.width);
  canvas.setAttribute("height", gifObj.height);
  var ctx = canvas.getContext("2d");
  
  var myImageData = [];
  for (var n = 0; n < gifObj.images.length; n++) {
    myImageData[n] = ctx.createImageData(gifObj.images[n].width, gifObj.images[n].height);
    
    var cells = gifObj.images[n].output.length;
    var i = 0, idx = 0;
    while (i < cells) {
      var rrggbb = gifObj.images[n].output[i];
      if (rrggbb == "transparent") {
        myImageData[n].data[idx] = 0;
        myImageData[n].data[idx+1] = 0;
        myImageData[n].data[idx+2] = 0;
        myImageData[n].data[idx+3] = 0; // this is the only one that matters
      } else {
        var r = parseInt(rrggbb.substring(1,3), 16),
            g = parseInt(rrggbb.substring(3,5), 16),
            b = parseInt(rrggbb.substring(5), 16);
        myImageData[n].data[idx] = r;
        myImageData[n].data[idx+1] = g;
        myImageData[n].data[idx+2] = b;
        myImageData[n].data[idx+3] = 255;
      }
      idx += 4;
      i++;
    }
  }
  
  gifDiv.appendChild(canvas);
  document.body.appendChild(gifDiv);
  
  animateGif(gifObj, function(last, n) {
    ctx.putImageData(myImageData[n], 0, 0);
  });
}

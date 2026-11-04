/* Implementation-grounded analysis guides, shared by inline help and the knowledgebase. */
(() => {
    'use strict';
    const png={title:'W3C PNG specification',url:'https://www.w3.org/TR/png-3/'},jpeg={title:'ITU-T T.81: JPEG',url:'https://www.itu.int/rec/T-REC-T.81/en'},nist={title:'NIST: chi-square goodness-of-fit',url:'https://www.itl.nist.gov/div898/handbook/eda/section3/eda35f.htm'};
    const entries={
        channels:{title:'Color channel layers',sections:[
            ['What you see','The red, green and blue views isolate one decoded color channel. Alpha is displayed as a grayscale opacity channel. An opaque image normally has a nearly uniform alpha view.'],
            ['Using the controls','Normal shows channel intensities. Enhanced increases visibility of weak differences. Bit Planes isolates a selected bit position; bit 0 is the least significant bit and bit 7 the most significant. Compare the same region across channels and bit positions.'],
            ['Reading a finding','Look for coherent lettering, repeated shapes or boundaries that do not track the visible subject. Texture, gradients, quantization and transparency can also produce patterns. A visible pattern is a lead; recover a consistent message or file in Decode before treating it as an extracted payload.'],
            ['What is measured','These views use the browser-decoded pixel canvas. They do not inspect the original PNG compressed stream or JPEG coefficient data. JPEG decoding and alpha handling can change how stored values appear.']
        ],sources:[png]},
        transforms:{title:'Steganalysis transforms',sections:[
            ['What each view does','Luminance applies a weighted RGB brightness conversion. Inverted subtracts each channel from 255. Edge Detection uses a Sobel gradient. Noise Residual subtracts a 3×3 local average and amplifies the difference around gray. XOR Checkerboard alternates an XOR mask across neighboring pixels.'],
            ['LSB randomness','The colored blocks count transitions between least-significant bits across RGB samples in 8×8 regions. The implementation uses fixed transition-ratio bands of 0.35 and 0.45. This is a visualization of bit changes, not an entropy estimate or a calibrated probability of steganography.'],
            ['How to inspect','Compare any unusual region with the original image and isolated channels. Sensor noise, sharp edges, JPEG artifacts and resizing can all appear strongly in these transforms. Use the views to select regions or decoding settings, then verify actual recovered bytes.']
        ],sources:[]},
        ycbcr:{title:'YCbCr color space',sections:[
            ['What you see','Y is a weighted luma-like view of the decoded RGB pixels. Cb and Cr emphasize blue-difference and red-difference chroma. This can make a pattern in color variation easier to notice than in overall brightness.'],
            ['How it is displayed','The app calculates Y = 0.299R + 0.587G + 0.114B, Cb = 128 − 0.168736R − 0.331264G + 0.5B, and Cr = 128 + 0.5R − 0.418688G − 0.081312B. Y is gray; Cb is mapped to blue/yellow and Cr to red/cyan for visibility.'],
            ['Reading a finding','Compare matching regions in Y, Cb and Cr. A coherent pattern confined to chroma can guide a Chroma decode attempt. Ordinary colored subjects and compression also create structure. These are reconstructed views from decoded RGB, not a direct display of the JPEG file’s stored chroma samples.']
        ],sources:[jpeg]},
        histogram:{title:'Histogram analysis',sections:[
            ['What the axes mean','The horizontal axis is channel intensity from 0 to 255. The vertical axis counts pixels at each intensity. Red, green and blue traces count their respective channels; luminance counts the rounded weighted brightness value. The display scales the traces to the largest bin count.'],
            ['A practical reading order','Start with the overall shape and compare it with the visible scene. Inspect broad peaks, clipped ends, gaps and differences between channels. Then compare adjacent intensity values and, when available, an unmodified source image.'],
            ['What a pattern can mean','A dark image naturally concentrates values toward the left; bright regions add values toward the right. Palette limits, editing and compression can create gaps or repeated peaks. LSB changes can redistribute adjacent values, but a histogram alone does not identify a message or prove that one exists.'],
            ['Continue the inspection','Use channel and bit-plane views for spatial detail, which the histogram discards. Use Decode to test a specific embedding method and verify the recovered content.']
        ],sources:[png]},
        'chi-square':{title:'Chi-square analysis',sections:[
            ['What this heatmap computes','For each 16×16 region, the app combines RGB samples into 128 even/odd pairs: (0,1), (2,3), and so on. Each pair is compared with an equal split of its observed total. The score sums (observed − expected)² / expected across non-empty pairs.'],
            ['Reading the colors','Green means a score below 10, yellow 10–50, and red at 50 or above. These fixed display bands represent lower, middle and higher deviation from the equal-pair model. They are not confidence levels or probabilities of a hidden payload.'],
            ['Why caution matters','The choice of expected distribution and sample size matters. Many pairs in a small image block have sparse counts. This app does not calculate degrees of freedom or a p-value for the map. A high score can reflect normal image structure; a lower score can reflect equalization without proving its cause.'],
            ['Next step','Compare the highlighted region with the original, histogram and bit planes. Treat a suspected pattern as a reason to investigate, and verify it through decoding or comparison with a known source.']
        ],sources:[nist]},
        dct:{title:'DCT block analysis',sections:[
            ['What this app actually shows','The view divides decoded luma into complete 8×8 blocks. DC Component displays each block’s mean brightness. Block Contrast displays the block’s standard deviation multiplied by four and clipped to the display range. Mid-Frequency Pattern uses an approximation based on pixel positions and differences from the block’s first sample.'],
            ['What it does not show','This view does not read the JPEG file’s quantized DCT coefficients and does not compute a complete frequency transform. The labels describe block summaries and an approximation; they cannot establish that a JPEG coefficient was modified. Incomplete edge blocks are omitted.'],
            ['How to use the views','Look for block boundaries or regions that differ from their neighbors, then compare them with the visible image and other transforms. JPEG compression, fine texture and ordinary edges can all produce block variation. For a suspected F5 or frequency-domain payload, use the relevant decoder on the original file bytes.']
        ],sources:[jpeg]},
        'file-inspection':{title:'File structure and appended data',sections:[
            ['Automatic inspection','Loading or transferring a file into Analyze starts its byte-level inspection. The same source file supplies the structure facts and metadata tree; no second file chooser or scan action is needed.'],
            ['Container boundaries','PNG is walked chunk by chunk to its parsed IEND. JPEG segments and scan markers are traversed to EOI. GIF blocks, RIFF container sizes and BMP header sizes provide their respective boundaries. A missing or malformed boundary is reported as undetermined or partial, not as a successful clean scan.'],
            ['Appended bytes and signatures','Bytes beyond the parsed container end are shown with their count and offset. The signature scan lists candidate byte patterns and all matched offsets. A ZIP signature can be an intentional image+ZIP container; a signature match alone does not validate an embedded file.'],
            ['Continue','Use the metadata tree to inspect the relevant records. Download a byte range or send it to another compatible tool when useful. Keep the original file for byte-preserving decoding and comparison.']
        ],sources:[png,jpeg]},
        metadata:{title:'Metadata and hidden-data indicators',sections:[
            ['Reading the overview','Each category shows its record count. Categories with records list their top-level group titles and instance counts immediately. Open a group to reveal its records and fields; Expand all exposes every group together. Zero means no supported records were collected in that category, not proof that the file has no hidden content.'],
            ['What is inspected','PNG chunks, JPEG segments, EXIF/TIFF directories, Photoshop/IPTC resources, XMP XML fields, ICC profile headers/tags and supported thumbnail records are inspected. GIF extensions, WebP/RIFF chunks, BMP headers and WAV format fields appear under Format details. Parsing failures and incomplete data are retained as inspection notes.'],
            ['Text and profiles','PNG tEXt is Latin-1 text. zTXt text is inflated before display; iTXt language, translated keyword and optional compression are parsed separately. PNG ICC profiles are inflated before reading their headers; complete JPEG ICC parts are reassembled in sequence order.'],
            ['Interpreting indicators','Appended data, candidate file signatures and base64-like text are leads. Normal metadata, embedded thumbnails and deliberate polyglots can explain them. File inspection does not automatically decode pixel-embedded messages. Export report includes the complete collected records even when groups are collapsed.']
        ],sources:[png]}
    };
    function el(tag,text,className){const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;}
    function article(id){const entry=entries[id]||entries.channels,root=el('article',undefined,'knowledge-article');root.append(el('h1',entry.title));for(const [title,text]of entry.sections){const section=el('section');section.append(el('h2',title),el('p',text));root.append(section);}if(entry.sources.length){const section=el('section');section.append(el('h2','References'));for(const source of entry.sources){const p=el('p'),a=el('a',source.title);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);section.append(p);}root.append(section);}return root;}
    let dialog,lastFocus;
    function open(id){if(!entries[id])return;lastFocus=document.activeElement;if(!dialog){dialog=el('dialog',undefined,'knowledge-dialog');dialog.setAttribute('aria-label','Analysis knowledgebase');document.body.append(dialog);dialog.addEventListener('cancel',()=>lastFocus?.focus({preventScroll:true}));}dialog.replaceChildren();const close=el('button','Close','btn btn-secondary');close.onclick=()=>{dialog.close();lastFocus?.focus({preventScroll:true});};dialog.append(close,article(id));dialog.showModal();}
    document.addEventListener('click',event=>{const link=event.target.closest('a[data-knowledge]');if(link){event.preventDefault();open(link.dataset.knowledge);}});
    document.addEventListener('DOMContentLoaded',()=>{
        const headings={'Color Channel Layers':'channels','Steganalysis Transforms':'transforms','YCbCr Color Space':'ycbcr','Histogram Analysis':'histogram','Chi-Square Analysis':'chi-square','DCT Block Analysis':'dct'};
        for(const h of document.querySelectorAll('#channel-layers-section h2')){const id=headings[h.textContent.trim()];if(!id)continue;const row=el('div',undefined,'analysis-card-heading'),link=el('a','About this view','analysis-help-link');h.replaceWith(row);row.append(h,link);link.href='knowledgebase.html#'+id;link.dataset.knowledge=id;link.setAttribute('aria-label','Read about '+entries[id].title);}
        if(document.body.dataset.knowledgePage!==undefined){
            const nav=document.getElementById('knowledge-nav'),content=document.getElementById('knowledge-content'),search=document.getElementById('knowledge-search');
            function render(){const query=search.value.toLowerCase();nav.replaceChildren();for(const [id,entry]of Object.entries(entries))if((entry.title+' '+entry.sections.flat().join(' ')).toLowerCase().includes(query)){const link=el('a',entry.title);link.href='#'+id;nav.append(link);}content.replaceChildren(article(location.hash.slice(1)||'channels'));}
            search.addEventListener('input',render);window.addEventListener('hashchange',render);render();
        }
    });
    window.ST3GGKnowledge=Object.freeze({entries,open,article});
})();

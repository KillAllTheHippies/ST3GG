/* Composed scene progressions; layer structure and techniques use the normal workspace controls. */
(function () {
    'use strict';
    const sequences = [
        ['zoom-in','Zoom into a landscape',5,'Mountain landscape → river valley → tree → branch → leaf',['landscape','valley','tree','branch','leaf']],
        ['zoom-out','Zoom out from a detail',5,'Leaf texture → leaf → branch → tree → forest',['texture','leaf','branch','tree','forest']],
        ['transform','Subject transformation',5,'An empty building plot → foundations → structural frame → enclosed building → completed building'],
        ['day-night','Day to night',5,'The same city street at dawn → at noon → at dusk → in the evening → at night'],
        ['seasons','Seasons',4,'The same tree in spring → in summer → in autumn → in winter',['spring','summer','autumn','winter']],
        ['time','Passage of time',5,'The same landscape in the Cambrian → in the Carboniferous → in the Jurassic → in the last ice age → in the present'],
        ['scale','Change of scale',5,'A human hand → an insect on the hand → a cell → a molecule → an atom'],
        ['colour','Colour progression',5,'The same still life in blue → in cyan → in green → in orange → in red'],
        ['style','Style progression',5,'The same portrait as a pencil sketch → as ink → as watercolour → as oil paint → as a realistic photograph'],
        ['explore','Scene exploration',5,'A library entrance → the reading room → a shelf → a book → a page'],
        ['storyboard','Storyboard',6,'A seed → the seed planted in soil → a sprout → a seedling → a sapling → a mature tree'],
        ['reveal','Gradual reveal',5,'A block of rough stone → a rough sculpture outline → a carved figure → a detailed sculpture → a polished sculpture']
    ];
    window.PolySequences = sequences.map(([id, title, count, brief, names]) => ({
        id, title, count, brief, names,
        description: `${count} AI images nested in sequence. ${brief}.`
    }));
})();

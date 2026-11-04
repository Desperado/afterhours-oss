/* Curated sample instruments. IDs are portable; recordings are installed locally. */
'use strict';
(function (root) {
  const catalog = [
    {id: 'growlybass', name: 'Growlybass · clean bass'},
    {id: 'freepats-guitar', name: 'FreePats · bridge guitar'},
    {id: 'virtuosity-drums', name: 'Virtuosity · stereo drums', drums: true},
    {id: 'vsco-flute', name: 'VSCO · flute'},
    {id: 'vsco-trumpet', name: 'VSCO · trumpet'},
    {id: 'vsco-horn', name: 'VSCO · French horn'},
    {id: 'vsco-tuba', name: 'VSCO · tuba'},
    {id: 'vsco-trombone', name: 'VSCO · trombone'},
    {id: 'vsco-harp', name: 'VSCO · harp'},
    {id: 'vsco-violins', name: 'VSCO · violin section'},
    {id: 'vsco-violas', name: 'VSCO · viola section'},
    {id: 'vsco-cellos', name: 'VSCO · cello section'},
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  else root.AfterhoursInstrumentCatalog = catalog;
})(typeof window === 'undefined' ? globalThis : window);

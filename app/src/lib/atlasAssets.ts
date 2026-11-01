import type { AtlasOptions } from './atlas';

// Metro needs static require paths to bundle the packs on web and mobile.
/* eslint-disable @typescript-eslint/no-require-imports */
const REGIONAL_ASSETS = {
  occitanie: require('../../assets/atlas/occitanie.ocat'),
  alpes: require('../../assets/atlas/alpes.ocat'),
  bretagne: require('../../assets/atlas/bretagne.ocat'),
  aquitaine: require('../../assets/atlas/aquitaine.ocat'),
  paca: require('../../assets/atlas/paca.ocat'),
  corse: require('../../assets/atlas/corse.ocat'),
  normandie: require('../../assets/atlas/normandie.ocat'),
  loire: require('../../assets/atlas/loire.ocat'),
  centre: require('../../assets/atlas/centre.ocat'),
  idf: require('../../assets/atlas/idf.ocat'),
  nord: require('../../assets/atlas/nord.ocat'),
  est: require('../../assets/atlas/est.ocat'),
  bourgogne: require('../../assets/atlas/bourgogne.ocat'),
};
const EUROPE = require('../../assets/atlas/europe.ocat');
/* eslint-enable @typescript-eslint/no-require-imports */

export function atlasAsset(zone: AtlasOptions['zone']) {
  return zone === 'europe' || zone === 'france' || zone === 'custom' ? EUROPE : REGIONAL_ASSETS[zone];
}

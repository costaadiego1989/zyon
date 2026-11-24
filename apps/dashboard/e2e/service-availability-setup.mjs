import setup from './service-local-setup.mjs';

export default function setupAvailability(){return setup({serviceReleaseFixture:'matching',availability:true,catalogProfessionals:true,attendance:true});}

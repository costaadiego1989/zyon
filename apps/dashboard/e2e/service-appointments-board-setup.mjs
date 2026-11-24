import setup from './service-local-setup.mjs';
export default function setupAppointmentBoard(){return setup({serviceReleaseFixture:'matching',appointmentJourneys:true,appointmentBoard:true});}

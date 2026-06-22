import { createCoWebApp } from './modules/app/application/createCoWebApp.js';

const app = createCoWebApp({
  root: document.querySelector('#app'),
});

app.start();

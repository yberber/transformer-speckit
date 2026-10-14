import { mount } from 'svelte';
import App from './App.svelte';
import './styles/fonts.css';
import './styles/theme.css';
import './styles/global.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app element missing from index.html');

export default mount(App, { target });

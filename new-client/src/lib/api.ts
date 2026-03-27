import { writable, get } from 'svelte/store';

// Default to user's config
const DEFAULT_API_URL = 'http://192.168.1.123:3089';

// Store for the API URL
export const apiUrl = writable(DEFAULT_API_URL);

// Initialize from localStorage if available
if (typeof localStorage !== 'undefined') {
  const stored = localStorage.getItem('myflix_api_url');
  if (stored && !stored.includes('localhost')) {
      apiUrl.set(stored);
  } else {
      apiUrl.set(DEFAULT_API_URL);
      localStorage.setItem('myflix_api_url', DEFAULT_API_URL);
  }
  
  apiUrl.subscribe(value => {
    localStorage.setItem('myflix_api_url', value);
  });
}

function getUrl() {
  return get(apiUrl).replace(/\/$/, '');
}

export async function getMovies() {
  const url = getUrl();
  try {
    const res = await fetch(`${url}/movies`);
    if (!res.ok) throw new Error('Network response was not ok');
    return res.json();
  } catch (e) {
    console.error("API Error:", e);
    return [];
  }
}

export function getStreamUrl(id: number) {
  const url = getUrl();
  return `${url}/stream/${id}`;
}

export function getPosterUrl(path: string | null) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/w500${path}`;
}

export function getBackdropUrl(path: string | null) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/original${path}`;
}

export async function getMovieDetails(tmdbId: number) {
  const url = getUrl();
  try {
    console.log(`Fetching details for TMDB ID: ${tmdbId}`);
    const res = await fetch(`${url}/tmdb/movie/${tmdbId}`);
    if (!res.ok) throw new Error(`TMDB request failed: ${res.status}`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("TMDB Error:", e);
    return null;
  }
}

export async function getContinueWatching() {
  const url = getUrl();
  try {
    const res = await fetch(`${url}/continue-watching`);
    if (!res.ok) throw new Error('Failed to fetch continue watching');
    return res.json();
  } catch (e) {
    console.error("Continue Watching Error:", e);
    return [];
  }
}

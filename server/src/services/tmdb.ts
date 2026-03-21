const TMDB_API_KEY = '7f43cb4adbc635ccad5c04412b284d34';

export async function searchMovie(query: string, year?: number) {
  if (!TMDB_API_KEY) {
    console.warn('TMDB API Key missing');
    return null;
  }
  
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('query', query);
  if (year) url.searchParams.set('year', year.toString());
  
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    
    if (data.results && data.results.length > 0) {
      return data.results[0];
    }
  } catch (e) {
    console.error('TMDB Fetch Error:', e);
  }
  return null;
}

export async function searchTVShow(query: string, year?: number) {
  if (!TMDB_API_KEY) {
    console.warn('TMDB API Key missing');
    return null;
  }
  
  const url = new URL('https://api.themoviedb.org/3/search/tv');
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('query', query);
  if (year) url.searchParams.set('first_air_date_year', year.toString());
  
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    
    if (data.results && data.results.length > 0) {
      return data.results[0];
    }
  } catch (e) {
    console.error('TMDB Fetch Error:', e);
  }
  return null;
}

export async function getTVSeasonDetails(tmdbId: number, seasonNumber: number) {
  if (!TMDB_API_KEY) return null;
  
  const url = new URL(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', 'fr-FR');
  
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('TMDB Season Fetch Error:', e);
  }
  return null;
}

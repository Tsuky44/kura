import { get } from 'svelte/store';
import { apiUrl } from './api';

export interface ViewingPattern {
  movieCount: number;
  tvCount: number;
  genreScores: Map<string, number>;
  totalWatchTime: number;
  preferredContentType: 'movie' | 'tv' | 'mixed';
}

export interface ScoredContent {
  item: any;
  score: number;
  reason: string;
}

/**
 * Analyse les habitudes de visionnage à partir de l'historique
 */
export function analyzeViewingPatterns(continueWatching: any[]): ViewingPattern {
  const genreScores = new Map<string, number>();
  let movieCount = 0;
  let tvCount = 0;
  let totalWatchTime = 0;

  for (const item of continueWatching) {
    // Compter films vs séries
    if (item.type === 'episode' || item.show_title) {
      tvCount++;
    } else {
      movieCount++;
    }

    // Calculer le temps de visionnage
    if (item.progress && item.duration) {
      totalWatchTime += item.progress;
    }

    // Analyser les genres
    if (item.genres && Array.isArray(item.genres)) {
      for (const genre of item.genres) {
        const currentScore = genreScores.get(genre) || 0;
        // Plus on a regardé, plus le genre a de points
        const watchRatio = item.duration ? (item.progress || 0) / item.duration : 0.5;
        genreScores.set(genre, currentScore + (1 + watchRatio));
      }
    }
  }

  // Déterminer le type de contenu préféré
  let preferredContentType: 'movie' | 'tv' | 'mixed' = 'mixed';
  if (movieCount > tvCount * 1.5) {
    preferredContentType = 'movie';
  } else if (tvCount > movieCount * 1.5) {
    preferredContentType = 'tv';
  }

  return {
    movieCount,
    tvCount,
    genreScores,
    totalWatchTime,
    preferredContentType
  };
}

/**
 * Calcule un score de recommandation pour un contenu
 */
export function calculateContentScore(
  item: any,
  patterns: ViewingPattern,
  allMovies: any[]
): ScoredContent {
  let score = 0;
  const reasons: string[] = [];

  // Score de base basé sur la popularité (0-20 points)
  const popularityScore = ((item.vote_average || 7) - 5) * 5;
  score += Math.max(0, popularityScore);

  // Bonus pour les nouveautés (0-10 points)
  const releaseYear = parseInt(item.release_date?.split('-')[0] || '2020');
  const currentYear = new Date().getFullYear();
  if (releaseYear >= currentYear - 1) {
    score += 10;
    reasons.push('Nouveauté');
  } else if (releaseYear >= currentYear - 3) {
    score += 5;
    reasons.push('Récent');
  }

  // Score basé sur les genres préférés (0-50 points)
  if (item.genres && Array.isArray(item.genres)) {
    let genreScore = 0;
    for (const genre of item.genres) {
      const genreWeight = patterns.genreScores.get(genre) || 0;
      genreScore += genreWeight * 10;
    }
    score += Math.min(50, genreScore);
    if (genreScore > 0) {
      reasons.push('Correspond à vos goûts');
    }
  }

  // Bonus si correspond au type préféré (0-40 points) - PONDÉRATION MAJOREE
  const isMovie = !item.show_title && item.type !== 'episode';
  const isShow = item.show_title || item.type === 'episode' || item.type === 'series';
  
  if (patterns.preferredContentType === 'movie' && isMovie) {
    score += 40;
    reasons.push('Amateur de films');
  } else if (patterns.preferredContentType === 'tv' && isShow) {
    score += 40;
    reasons.push('Fan de séries');
  }
  
  // Pénalité si c'est le type opposé au préférence forte
  if (patterns.preferredContentType === 'tv' && isMovie && patterns.tvCount > patterns.movieCount * 2) {
    score -= 15; // Pénalité modérée pour les films si on regarde BEAUCOUP plus de séries
  } else if (patterns.preferredContentType === 'movie' && isShow && patterns.movieCount > patterns.tvCount * 2) {
    score -= 15;
  }

  // Pénalité si déjà regardé (mais pas terminé = on garde dans Continue Watching)
  const isInContinueWatching = allMovies.some(m => 
    m.id === item.id && m.progress && m.progress > 0
  );
  if (isInContinueWatching) {
    score -= 30;
  }

  // Bonus diversité - favoriser les contenus moins vus (0-10 points)
  const voteCount = item.vote_count || 0;
  if (voteCount < 1000) {
    score += 5;
    reasons.push('Pépites cachées');
  }

  return {
    item,
    score: Math.max(0, score),
    reason: reasons[0] || 'Popular'
  };
}

/**
 * Génère des recommandations personnalisées
 */
export function generateRecommendations(
  allMovies: any[],
  continueWatching: any[],
  limit: number = 20
): ScoredContent[] {
  if (allMovies.length === 0) return [];

  // Si pas d'historique, retourner les plus populaires
  if (continueWatching.length === 0) {
    return allMovies
      .map(m => ({
        item: m,
        score: (m.vote_average || 7) * 10,
        reason: 'Populaire'
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Analyser les patterns
  const patterns = analyzeViewingPatterns(continueWatching);

  // Calculer les scores pour tous les films
  const scored = allMovies.map(movie => 
    calculateContentScore(movie, patterns, allMovies)
  );

  // Trier par score décroissant
  scored.sort((a, b) => b.score - a.score);

  // Retourner les meilleures recommandations
  return scored.slice(0, limit);
}

/**
 * Génère le contenu pour le hero carousel (top 5 personnalisé)
 */
export function getHeroRecommendations(
  allMovies: any[],
  continueWatching: any[]
): any[] {
  if (allMovies.length === 0) return [];
  
  const recommendations = generateRecommendations(allMovies, continueWatching, 15);
  
  // Prendre ceux avec backdrop d'abord, sinon poster
  const withBackdrop = recommendations.filter(r => r.item.backdrop_path);
  const withPoster = recommendations.filter(r => !r.item.backdrop_path && r.item.poster_path);
  
  // Combiner : backdrop d'abord, puis poster
  const candidates = [...withBackdrop, ...withPoster];
  
  // Mélanger un peu pour la diversité
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  
  return shuffled.slice(0, 5).map(r => r.item);
}

/**
 * Sépare les recommandations en catégories
 */
export function categorizeRecommendations(
  scored: ScoredContent[]
): {
  becauseYouWatched: ScoredContent[];
  trending: ScoredContent[];
  hiddenGems: ScoredContent[];
  moreLikeThis: ScoredContent[];
} {
  return {
    becauseYouWatched: scored.filter(s => s.reason === 'Matches your taste').slice(0, 6),
    trending: scored.filter(s => s.reason === 'New release' || s.reason === 'Recent').slice(0, 6),
    hiddenGems: scored.filter(s => s.reason === 'Hidden gem').slice(0, 6),
    moreLikeThis: scored.slice(6, 12)
  };
}

/**
 * Détecte les genres préférés pour l'affichage
 */
export function getTopGenres(patterns: ViewingPattern, limit: number = 3): string[] {
  const sorted = Array.from(patterns.genreScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([genre]) => genre);
  
  return sorted;
}

/**
 * Message personnalisé selon les préférences
 */
export function getPersonalizedMessage(patterns: ViewingPattern): string {
  if (patterns.preferredContentType === 'movie') {
    if (patterns.movieCount > 5) {
      return 'Passionné de films détecté ! Voici d\'autres films pour vous.';
    }
    return 'Basé sur vos visionnages de films, vous pourriez aimer ceux-ci.';
  } else if (patterns.preferredContentType === 'tv') {
    if (patterns.tvCount > 5) {
      return 'Alerte binge-watcher ! Plus de séries à dévorer.';
    }
    return 'Puisque vous aimez les séries, découvrez celles-ci.';
  }
  return 'Sélectionné pour vous selon vos goûts.';
}

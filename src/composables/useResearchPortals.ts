import { ref } from 'vue';
import type { ResearchPortalConfig } from '../types/research';

export const DEFAULT_RESEARCH_PORTALS: ResearchPortalConfig[] = [
  {
    id: 'familysearch',
    name: 'FamilySearch',
    category: 'Kirchenbücher & Standesamt weltweit',
    description_de: 'Weltweites Archiv, Zivilstandsregister, Volkszählungen und Kirchenbuch-Indexe.',
    description_en: 'Worldwide archive, civil registration, censuses and parish register indexes.',
    access_type: 'free_registration',
    enabled: true,
    icon: '🌐',
    url_template: 'https://www.familysearch.org/search/record/results?q.givenName={given}&q.surname={surname}&q.birthLikeDate.from={birth_from}&q.birthLikeDate.to={birth_to}&q.birthLikePlace={birth_place}',
  },
  {
    id: 'matricula',
    name: 'Matricula Online',
    category: 'Kirchenbücher (katholisch)',
    description_de: 'Original-Digitalisate historischer katholischer Kirchenbücher aus Deutschland, Österreich und Polen.',
    description_en: 'Original digital images of historical Catholic parish registers from Germany, Austria and Poland.',
    access_type: 'free',
    enabled: true,
    icon: '📖',
    url_template: 'https://data.matricula-online.eu/de/suchen/?place={place}',
  },
  {
    id: 'archion',
    name: 'Archion',
    category: 'Kirchenbücher (evangelisch)',
    description_de: 'Digitalisierte evangelische Kirchenbücher aus fast allen deutschen Landeskirchen.',
    description_en: 'Digitized Protestant parish registers from almost all German regional churches.',
    access_type: 'subscription',
    enabled: false,
    icon: '⛪',
    url_template: 'https://www.archion.de/de/suche/?searchQuery={place}',
  },
  {
    id: 'ancestry',
    name: 'Ancestry',
    category: 'Standesamt, Militär & Passagierlisten',
    description_de: 'Weltgrößte Personendatenbank; Standesamtsurkunden (Berlin, Hamburg, Ruhrgebiet etc.), Passagierlisten und Stammbäume.',
    description_en: 'Largest genealogical database; civil records, passenger lists, military records and family trees.',
    access_type: 'subscription',
    enabled: false,
    icon: '🌳',
    url_template: 'https://www.ancestry.de/search/?name={given}_{surname}&birth={birth_year}&birth_x=2-0-0&location={place}',
  },
  {
    id: 'myheritage',
    name: 'MyHeritage',
    category: 'Internationale Datenbanken & Stammbäume',
    description_de: 'Internationale historische Aufzeichnungen, Smart Matches, Zeitungsarchive und Stammbäume.',
    description_en: 'International historical records, Smart Matches, historical newspapers and family trees.',
    access_type: 'subscription',
    enabled: false,
    icon: '🌍',
    url_template: 'https://www.myheritage.de/research?action=query&formId=master&formMode=1&qname=Name+fn.{given}+ln.{surname}',
  },
  {
    id: 'compgen_gedbas',
    name: 'CompGen GEDBAS',
    category: 'Forscherdatenbanken & Ortsfamilienbücher',
    description_de: 'Deutsche genealogische Datenbanken, Ortsfamilienbücher (OFB) und Verlustlisten des CompGen e.V.',
    description_en: 'German genealogical databases, local heritage books (OFB) and casualty lists by CompGen e.V.',
    access_type: 'free',
    enabled: true,
    icon: '👥',
    url_template: 'https://gedbas.genealogy.net/search/simple?givenname={given}&surname={surname}',
  },
  {
    id: 'meyers',
    name: 'Meyers Gazetteer & GOV',
    category: 'Historisches Ortsverzeichnis',
    description_de: 'Historisches Ortslexikon des Deutschen Reichs (1871–1918) zur Ermittlung zuständiger Pfarreien und Standesämter.',
    description_en: 'Historical gazetteer of the German Empire (1871–1918) to determine responsible parishes and civil registries.',
    access_type: 'free',
    enabled: true,
    icon: '🗺️',
    url_template: 'https://www.meyersgaz.org/search?search={place}',
  },
  {
    id: 'findagrave',
    name: 'Find a Grave',
    category: 'Friedhöfe & Grabsteine',
    description_de: 'Weltweite Friedhofs- und Grabsteindatenbank mit Fotos, Inschriften und Todesdaten.',
    description_en: 'Worldwide cemetery and grave database with photos, inscriptions and death dates.',
    access_type: 'free',
    enabled: true,
    icon: '🪦',
    url_template: 'https://www.findagrave.com/memorial/search?firstname={given}&lastname={surname}',
  },
  {
    id: 'geneanet',
    name: 'Geneanet',
    category: 'Mitteleuropa & Frankreich',
    description_de: 'Genealogische Datenbank mit Schwerpunkt West- und Mitteleuropa, Archivalien und Grabsteine.',
    description_en: 'Genealogical database with focus on Western and Central Europe, archives and memorials.',
    access_type: 'freemium',
    enabled: false,
    icon: '⚜️',
    url_template: 'https://de.geneanet.org/fonds/individus/?nom={surname}&prenom={given}',
  },
];

const portalsState = ref<ResearchPortalConfig[]>(loadStoredPortals());

function loadStoredPortals(): ResearchPortalConfig[] {
  try {
    const raw = localStorage.getItem('lineagegraph_research_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.portals) && parsed.portals.length > 0) {
        // Merge with defaults to ensure all fields and any newly added portals are present
        return DEFAULT_RESEARCH_PORTALS.map(def => {
          const found = parsed.portals.find((p: ResearchPortalConfig) => p.id === def.id);
          return found ? { ...def, enabled: Boolean(found.enabled) } : def;
        });
      }
    }
  } catch (e) {
    console.warn('Failed to load stored research portals:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_RESEARCH_PORTALS));
}

function savePortals(portals: ResearchPortalConfig[]) {
  portalsState.value = portals;
  try {
    let settings: any = {};
    const raw = localStorage.getItem('lineagegraph_research_settings');
    if (raw) {
      try {
        settings = JSON.parse(raw);
      } catch {}
    }
    settings.portals = portals.map(p => ({ id: p.id, enabled: p.enabled }));
    localStorage.setItem('lineagegraph_research_settings', JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save research portals to localStorage:', e);
  }
}

function extractYear(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const match = dateStr.match(/\b(1\d{3}|20\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

export function useResearchPortals() {
  function getPortals(): ResearchPortalConfig[] {
    return portalsState.value;
  }

  function getEnabledPortals(): ResearchPortalConfig[] {
    return portalsState.value.filter(p => p.enabled);
  }

  function togglePortal(portalId: string) {
    const updated = portalsState.value.map(p => {
      if (p.id === portalId) {
        return { ...p, enabled: !p.enabled };
      }
      return p;
    });
    savePortals(updated);
  }

  function resetToDefaults() {
    savePortals(JSON.parse(JSON.stringify(DEFAULT_RESEARCH_PORTALS)));
  }

  function generatePortalUrl(
    portal: ResearchPortalConfig,
    context: {
      givenName?: string | null;
      surname?: string | null;
      birthDate?: string | null;
      deathDate?: string | null;
      birthPlace?: string | null;
      deathPlace?: string | null;
    }
  ): string | null {
    let url = portal.url_template;

    const g = (context.givenName || '').trim();
    const s = (context.surname || '').trim();
    const bp = (context.birthPlace || '').trim();
    const dp = (context.deathPlace || '').trim();
    const primaryPlace = bp || dp;

    const birthYear = extractYear(context.birthDate);
    const deathYear = extractYear(context.deathDate);

    // If portal strictly requires place (like Matricula or Archion or Meyers) and no place exists, return base search
    if (portal.id === 'matricula' && !primaryPlace) {
      return 'https://data.matricula-online.eu/de/suchen/';
    }
    if (portal.id === 'archion' && !primaryPlace) {
      return 'https://www.archion.de/de/suche/';
    }
    if (portal.id === 'meyers' && !primaryPlace) {
      return 'https://www.meyersgaz.org/';
    }

    // Replace template tokens
    url = url.replace(/\{given\}/g, encodeURIComponent(g));
    url = url.replace(/\{surname\}/g, encodeURIComponent(s));
    url = url.replace(/\{place\}/g, encodeURIComponent(primaryPlace));
    url = url.replace(/\{birth_place\}/g, encodeURIComponent(bp || primaryPlace));
    url = url.replace(/\{death_place\}/g, encodeURIComponent(dp || primaryPlace));

    url = url.replace(/\{birth_year\}/g, birthYear ? String(birthYear) : '');
    url = url.replace(/\{death_year\}/g, deathYear ? String(deathYear) : '');
    url = url.replace(/\{birth_from\}/g, birthYear ? String(birthYear - 5) : '');
    url = url.replace(/\{birth_to\}/g, birthYear ? String(birthYear + 5) : '');

    // Cleanup empty query parameters like &location=& or similar dangling trailing tokens
    url = url.replace(/(&|\?)[^&=]+=(&|$)/g, '$1');
    url = url.replace(/[&?]$/, '');

    return url;
  }

  return {
    portals: portalsState,
    getPortals,
    getEnabledPortals,
    togglePortal,
    resetToDefaults,
    generatePortalUrl,
  };
}

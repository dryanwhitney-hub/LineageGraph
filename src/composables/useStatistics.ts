import { computed, ref, type Ref } from 'vue';
import type { Person, RootAncestorConfig } from './usePersons';
import {
  computeAgeYears,
  computeIntervalYears,
  getCentury,
  isDateUsable,
  parseGedcomDate,
  type ParsedGedcomDate,
} from '../utils/gedcomDate';

export interface StatBucket {
  key: string;
  label: string;
  value: number;
  personIds: string[];
  extra?: Record<string, string | number>;
}

export interface GroupedSeriesBucket {
  groupKey: string;
  groupLabel: string;
  values: {
    seriesKey: string;
    seriesLabel: string;
    value: number;
    n: number;
    personIds: string[];
  }[];
}

export interface LineSeries {
  key: string;
  label: string;
  points: {
    xKey: string;
    xLabel: string;
    value: number;
    n: number;
    personIds: string[];
  }[];
}

export interface FamilySummary {
  key: string;
  label: string;
  parentIds: string[];
  childrenIds: string[];
  childCount: number;
}

export interface ImplexGenerationRow {
  generation: number;
  theoretical: number;
  occupiedSlots: number;
  uniqueCount: number;
  duplicateCount: number;
  lossPercent: number;
  duplicatePersonIds: string[];
}

export interface StatisticsFilterState {
  probandId: string; // 'all' or person_id
  sex: 'all' | 'M' | 'F';
  yearFrom: number | null;
  yearTo: number | null;
  onlyExactDates: boolean;
  familyGrouping: 'couple' | 'person';
}

function normalizeSex(sex: string | null | undefined): 'M' | 'F' | 'U' {
  const s = (sex ?? '').trim().toUpperCase();
  if (s === 'M' || s === 'MALE' || s === 'MÄNNLICH') return 'M';
  if (s === 'F' || s === 'W' || s === 'FEMALE' || s === 'WEIBLICH') return 'F';
  return 'U';
}

function formatPersonName(p: Person | undefined): string {
  if (!p) return '?';
  const name = [p.given_name, p.surname].filter(Boolean).join(' ').trim();
  return name || p.id;
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function useStatistics(
  persons: Ref<Person[]>,
  rootAncestors: Ref<RootAncestorConfig[]>,
  activeProbandTab: Ref<string | null>
) {
  const filters = ref<StatisticsFilterState>({
    probandId: 'all',
    sex: 'all',
    yearFrom: null,
    yearTo: null,
    onlyExactDates: false,
    familyGrouping: 'couple',
  });

  const personById = computed(() => {
    const map = new Map<string, Person>();
    for (const p of persons.value) {
      map.set(p.id, p);
    }
    return map;
  });

  const parsedDatesById = computed(() => {
    const map = new Map<string, { birth: ParsedGedcomDate; death: ParsedGedcomDate }>();
    for (const p of persons.value) {
      map.set(p.id, {
        birth: parseGedcomDate(p.birth_date),
        death: parseGedcomDate(p.death_date),
      });
    }
    return map;
  });

  const filteredPersons = computed(() => {
    const { probandId, sex, yearFrom, yearTo, onlyExactDates } = filters.value;
    return persons.value.filter((p) => {
      if (probandId !== 'all') {
        if (!p.proband_data || !p.proband_data[probandId]) {
          return false;
        }
      }
      if (sex !== 'all') {
        if (normalizeSex(p.sex) !== sex) return false;
      }
      if (yearFrom !== null || yearTo !== null) {
        const dates = parsedDatesById.value.get(p.id);
        const refDate =
          dates && isDateUsable(dates.birth, onlyExactDates)
            ? dates.birth
            : dates && isDateUsable(dates.death, onlyExactDates)
              ? dates.death
              : null;
        if (!refDate || refDate.year === null) return false;
        if (yearFrom !== null && refDate.year < yearFrom) return false;
        if (yearTo !== null && refDate.year > yearTo) return false;
      }
      return true;
    });
  });

  const filteredPersonIdSet = computed(() => new Set(filteredPersons.value.map((p) => p.id)));

  // =========================================================================
  // 1. DEMOGRAFIE & LEBENSZEIT
  // =========================================================================
  const demographics = computed(() => {
    const onlyExact = filters.value.onlyExactDates;
    const ages: { personId: string; age: number; sex: 'M' | 'F' | 'U'; birthCentury: number | null }[] = [];

    const ageBucketsDef = [
      { key: '0-1', label: '0–1', min: 0, max: 1.9999 },
      { key: '2-5', label: '2–5', min: 2, max: 5.9999 },
      { key: '6-14', label: '6–14', min: 6, max: 14.9999 },
      { key: '15-29', label: '15–29', min: 15, max: 29.9999 },
      { key: '30-49', label: '30–49', min: 30, max: 49.9999 },
      { key: '50-69', label: '50–69', min: 50, max: 69.9999 },
      { key: '70-84', label: '70–84', min: 70, max: 84.9999 },
      { key: '85+', label: '85+', min: 85, max: 200 },
    ];
    const ageBuckets: StatBucket[] = ageBucketsDef.map((b) => ({
      key: b.key,
      label: b.label,
      value: 0,
      personIds: [],
    }));

    const sexCounts: Record<'M' | 'F' | 'U', string[]> = { M: [], F: [], U: [] };
    const birthMonths: string[][] = Array.from({ length: 12 }, () => []);
    const deathMonths: string[][] = Array.from({ length: 12 }, () => []);

    const centuryMap = new Map<
      number,
      { M: { age: number; id: string }[]; F: { age: number; id: string }[]; all: { age: number; id: string }[]; infantIds: string[]; childIds: string[] }
    >();

    for (const p of filteredPersons.value) {
      const s = normalizeSex(p.sex);
      sexCounts[s].push(p.id);

      const dates = parsedDatesById.value.get(p.id);
      if (!dates) continue;

      if (dates.birth.month && dates.birth.precision !== 'excluded' && (!onlyExact || dates.birth.precision === 'exact')) {
        birthMonths[dates.birth.month - 1].push(p.id);
      }
      if (dates.death.month && dates.death.precision !== 'excluded' && (!onlyExact || dates.death.precision === 'exact')) {
        deathMonths[dates.death.month - 1].push(p.id);
      }

      const age = computeAgeYears(dates.birth, dates.death, onlyExact);
      if (age !== null) {
        const birthCentury = dates.birth.year ? getCentury(dates.birth.year) : null;
        ages.push({ personId: p.id, age, sex: s, birthCentury });

        const bucketIdx = ageBucketsDef.findIndex((b) => age >= b.min && age <= b.max);
        if (bucketIdx >= 0) {
          ageBuckets[bucketIdx].value += 1;
          ageBuckets[bucketIdx].personIds.push(p.id);
        }

        if (birthCentury !== null) {
          if (!centuryMap.has(birthCentury)) {
            centuryMap.set(birthCentury, { M: [], F: [], all: [], infantIds: [], childIds: [] });
          }
          const cEntry = centuryMap.get(birthCentury)!;
          cEntry.all.push({ age, id: p.id });
          if (s === 'M') cEntry.M.push({ age, id: p.id });
          if (s === 'F') cEntry.F.push({ age, id: p.id });
          if (age < 1) cEntry.infantIds.push(p.id);
          if (age < 15) cEntry.childIds.push(p.id);
        }
      }
    }

    const allAgeNums = ages.map((a) => a.age);
    const maleAgeNums = ages.filter((a) => a.sex === 'M').map((a) => a.age);
    const femaleAgeNums = ages.filter((a) => a.sex === 'F').map((a) => a.age);

    const sortedCenturies = Array.from(centuryMap.keys()).sort((a, b) => a - b);
    const lifeExpectancyByCentury: GroupedSeriesBucket[] = sortedCenturies.map((c) => {
      const entry = centuryMap.get(c)!;
      return {
        groupKey: String(c),
        groupLabel: `${c}.`,
        values: [
          {
            seriesKey: 'M',
            seriesLabel: 'M',
            value: average(entry.M.map((x) => x.age)) ?? 0,
            n: entry.M.length,
            personIds: entry.M.map((x) => x.id),
          },
          {
            seriesKey: 'F',
            seriesLabel: 'F',
            value: average(entry.F.map((x) => x.age)) ?? 0,
            n: entry.F.length,
            personIds: entry.F.map((x) => x.id),
          },
        ],
      };
    });

    const infantMortalityLine: LineSeries = {
      key: 'infant',
      label: '< 1',
      points: sortedCenturies.map((c) => {
        const entry = centuryMap.get(c)!;
        const pct = entry.all.length > 0 ? (entry.infantIds.length / entry.all.length) * 100 : 0;
        return {
          xKey: String(c),
          xLabel: `${c}.`,
          value: pct,
          n: entry.all.length,
          personIds: entry.infantIds,
        };
      }),
    };

    const childMortalityLine: LineSeries = {
      key: 'child',
      label: '< 15',
      points: sortedCenturies.map((c) => {
        const entry = centuryMap.get(c)!;
        const pct = entry.all.length > 0 ? (entry.childIds.length / entry.all.length) * 100 : 0;
        return {
          xKey: String(c),
          xLabel: `${c}.`,
          value: pct,
          n: entry.all.length,
          personIds: entry.childIds,
        };
      }),
    };

    const infantTotalIds = ages.filter((a) => a.age < 1).map((a) => a.personId);
    const childTotalIds = ages.filter((a) => a.age < 15).map((a) => a.personId);

    return {
      ageSampleSize: ages.length,
      avgAge: average(allAgeNums),
      medianAge: median(allAgeNums),
      avgAgeMale: average(maleAgeNums),
      maleAgeN: maleAgeNums.length,
      avgAgeFemale: average(femaleAgeNums),
      femaleAgeN: femaleAgeNums.length,
      ageBuckets,
      lifeExpectancyByCentury,
      infantMortalityRate: ages.length > 0 ? (infantTotalIds.length / ages.length) * 100 : null,
      infantTotalIds,
      childMortalityRate: ages.length > 0 ? (childTotalIds.length / ages.length) * 100 : null,
      childTotalIds,
      mortalitySeries: [infantMortalityLine, childMortalityLine],
      sexBuckets: [
        { key: 'M', label: 'M', value: sexCounts.M.length, personIds: sexCounts.M },
        { key: 'F', label: 'F', value: sexCounts.F.length, personIds: sexCounts.F },
        { key: 'U', label: 'U', value: sexCounts.U.length, personIds: sexCounts.U },
      ] as StatBucket[],
      birthMonths: birthMonths.map((ids, idx) => ({
        key: String(idx + 1),
        label: String(idx + 1),
        value: ids.length,
        personIds: ids,
      })),
      birthMonthN: birthMonths.reduce((acc, arr) => acc + arr.length, 0),
      deathMonths: deathMonths.map((ids, idx) => ({
        key: String(idx + 1),
        label: String(idx + 1),
        value: ids.length,
        personIds: ids,
      })),
      deathMonthN: deathMonths.reduce((acc, arr) => acc + arr.length, 0),
    };
  });

  // =========================================================================
  // 2. FAMILIEN (Familiengrößen, Heiratsalter, Geburtenabstände, Heiratssaisonalität)
  // =========================================================================
  const families = computed(() => {
    const onlyExact = filters.value.onlyExactDates;
    const grouping = filters.value.familyGrouping;
    const filteredIds = filteredPersonIdSet.value;

    // Build couple families across the whole tree, keeping those relevant to filteredPersons
    const coupleMap = new Map<string, { parentIds: string[]; childrenIds: Set<string> }>();

    // Seed with married couples where at least one partner is in filteredPersons
    for (const p of filteredPersons.value) {
      for (const sp of p.spouses ?? []) {
        const pair = [p.id, sp.id].sort();
        const key = `couple:${pair[0]}__${pair[1]}`;
        if (!coupleMap.has(key)) {
          coupleMap.set(key, { parentIds: pair, childrenIds: new Set() });
        }
      }
    }

    // Attach children (from all persons so parent couples in filter get accurate child counts)
    for (const child of persons.value) {
      const fId = child.father_id ?? null;
      const mId = child.mother_id ?? null;
      if (!fId && !mId) continue;

      // Only include if at least one parent (or the child) is in filteredPersons
      const relevant =
        (fId && filteredIds.has(fId)) ||
        (mId && filteredIds.has(mId)) ||
        filteredIds.has(child.id);
      if (!relevant) continue;

      let key: string;
      let parentIds: string[];
      if (fId && mId) {
        const pair = [fId, mId].sort();
        key = `couple:${pair[0]}__${pair[1]}`;
        parentIds = pair;
      } else {
        const singleId = (fId || mId)!;
        key = `single:${singleId}`;
        parentIds = [singleId];
      }

      if (!coupleMap.has(key)) {
        coupleMap.set(key, { parentIds, childrenIds: new Set() });
      }
      coupleMap.get(key)!.childrenIds.add(child.id);
    }

    const familyList: FamilySummary[] = [];
    if (grouping === 'couple') {
      for (const [key, val] of coupleMap.entries()) {
        const parentNames = val.parentIds.map((id) => formatPersonName(personById.value.get(id)));
        familyList.push({
          key,
          label: parentNames.join(' & '),
          parentIds: val.parentIds,
          childrenIds: Array.from(val.childrenIds),
          childCount: val.childrenIds.size,
        });
      }
    } else {
      // Per-person child count
      for (const p of filteredPersons.value) {
        const kids = p.children_ids ?? [];
        const hasSpouse = (p.spouses?.length ?? 0) > 0;
        if (kids.length > 0 || hasSpouse) {
          familyList.push({
            key: `person:${p.id}`,
            label: formatPersonName(p),
            parentIds: [p.id],
            childrenIds: [...kids],
            childCount: kids.length,
          });
        }
      }
    }

    // Child count distribution (0, 1, 2, 3, 4, 5, 6+)
    const sizeLabels = ['0', '1', '2', '3', '4', '5', '6+'];
    const sizeBuckets: StatBucket[] = sizeLabels.map((lbl) => ({
      key: lbl,
      label: lbl,
      value: 0,
      personIds: [],
    }));
    const childCounts: number[] = [];
    for (const fam of familyList) {
      childCounts.push(fam.childCount);
      const idx = Math.min(fam.childCount, 6);
      sizeBuckets[idx].value += 1;
      for (const pid of fam.parentIds) {
        if (!sizeBuckets[idx].personIds.includes(pid)) {
          sizeBuckets[idx].personIds.push(pid);
        }
      }
    }

    const largestFamilies = [...familyList]
      .filter((f) => f.childCount > 0)
      .sort((a, b) => b.childCount - a.childCount)
      .slice(0, 10);

    // Marriage ages & marriage seasonality (deduplicated per spouse pair)
    const seenMarriages = new Set<string>();
    const marriageAgesMale: { age: number; id: string; century: number | null }[] = [];
    const marriageAgesFemale: { age: number; id: string; century: number | null }[] = [];
    const marriageMonths: string[][] = Array.from({ length: 12 }, () => []);

    for (const p of filteredPersons.value) {
      for (const sp of p.spouses ?? []) {
        const pairKey = [p.id, sp.id].sort().join('__');
        const marriageDate = parseGedcomDate(sp.date);

        if (!seenMarriages.has(pairKey)) {
          seenMarriages.add(pairKey);
          if (
            marriageDate.month &&
            marriageDate.precision !== 'excluded' &&
            (!onlyExact || marriageDate.precision === 'exact')
          ) {
            marriageMonths[marriageDate.month - 1].push(p.id);
          }
        }

        const pBirth = parsedDatesById.value.get(p.id)?.birth;
        if (pBirth) {
          const mAge = computeAgeYears(pBirth, marriageDate, onlyExact);
          if (mAge !== null && mAge >= 12 && mAge <= 95) {
            const s = normalizeSex(p.sex);
            const cent = marriageDate.year ? getCentury(marriageDate.year) : null;
            if (s === 'M') marriageAgesMale.push({ age: mAge, id: p.id, century: cent });
            if (s === 'F') marriageAgesFemale.push({ age: mAge, id: p.id, century: cent });
          }
        }
      }
    }

    const marriageAgeCenturySet = new Set<number>([
      ...marriageAgesMale.map((x) => x.century).filter((c): c is number => c !== null),
      ...marriageAgesFemale.map((x) => x.century).filter((c): c is number => c !== null),
    ]);
    const marriageAgeByCentury: GroupedSeriesBucket[] = Array.from(marriageAgeCenturySet)
      .sort((a, b) => a - b)
      .map((c) => {
        const mList = marriageAgesMale.filter((x) => x.century === c);
        const fList = marriageAgesFemale.filter((x) => x.century === c);
        return {
          groupKey: String(c),
          groupLabel: `${c}.`,
          values: [
            {
              seriesKey: 'M',
              seriesLabel: 'M',
              value: average(mList.map((x) => x.age)) ?? 0,
              n: mList.length,
              personIds: mList.map((x) => x.id),
            },
            {
              seriesKey: 'F',
              seriesLabel: 'F',
              value: average(fList.map((x) => x.age)) ?? 0,
              n: fList.length,
              personIds: fList.map((x) => x.id),
            },
          ],
        };
      });

    // Parenthood ages (first & last child) and sibling birth intervals (always per couple family)
    const motherFirstAges: number[] = [];
    const motherLastAges: number[] = [];
    const fatherFirstAges: number[] = [];
    const fatherLastAges: number[] = [];
    const siblingIntervalsYears: number[] = [];

    for (const fam of coupleMap.values()) {
      const datedChildren = Array.from(fam.childrenIds)
        .map((cid) => ({ id: cid, birth: parsedDatesById.value.get(cid)?.birth }))
        .filter((c): c is { id: string; birth: ParsedGedcomDate } => !!c.birth && isDateUsable(c.birth, onlyExact))
        .sort((a, b) => {
          const ya = a.birth.year ?? 0;
          const yb = b.birth.year ?? 0;
          if (ya !== yb) return ya - yb;
          const ma = a.birth.month ?? 6;
          const mb = b.birth.month ?? 6;
          if (ma !== mb) return ma - mb;
          return (a.birth.day ?? 15) - (b.birth.day ?? 15);
        });

      if (datedChildren.length >= 2) {
        for (let i = 0; i < datedChildren.length - 1; i++) {
          const diff = computeIntervalYears(datedChildren[i].birth, datedChildren[i + 1].birth, onlyExact);
          if (diff !== null) siblingIntervalsYears.push(diff);
        }
      }

      if (datedChildren.length >= 1) {
        const firstBirth = datedChildren[0].birth;
        const lastBirth = datedChildren[datedChildren.length - 1].birth;

        for (const pid of fam.parentIds) {
          const parent = personById.value.get(pid);
          const parentBirth = parsedDatesById.value.get(pid)?.birth;
          if (!parent || !parentBirth) continue;

          const firstAge = computeAgeYears(parentBirth, firstBirth, onlyExact);
          const lastAge = computeAgeYears(parentBirth, lastBirth, onlyExact);
          const pSex = normalizeSex(parent.sex);

          if (firstAge !== null && firstAge >= 12 && firstAge <= 80) {
            if (pSex === 'F') motherFirstAges.push(firstAge);
            if (pSex === 'M') fatherFirstAges.push(firstAge);
          }
          if (lastAge !== null && lastAge >= 12 && lastAge <= 85) {
            if (pSex === 'F') motherLastAges.push(lastAge);
            if (pSex === 'M') fatherLastAges.push(lastAge);
          }
        }
      }
    }

    return {
      totalFamilies: familyList.length,
      avgChildren: average(childCounts),
      medianChildren: median(childCounts),
      sizeBuckets,
      largestFamilies,
      marriageAgeMaleAvg: average(marriageAgesMale.map((x) => x.age)),
      marriageAgeMaleN: marriageAgesMale.length,
      marriageAgeFemaleAvg: average(marriageAgesFemale.map((x) => x.age)),
      marriageAgeFemaleN: marriageAgesFemale.length,
      marriageAgeByCentury,
      marriageMonths: marriageMonths.map((ids, idx) => ({
        key: String(idx + 1),
        label: String(idx + 1),
        value: ids.length,
        personIds: ids,
      })),
      marriageMonthN: marriageMonths.reduce((acc, arr) => acc + arr.length, 0),
      motherFirstAvg: average(motherFirstAges),
      motherFirstN: motherFirstAges.length,
      motherLastAvg: average(motherLastAges),
      motherLastN: motherLastAges.length,
      fatherFirstAvg: average(fatherFirstAges),
      fatherFirstN: fatherFirstAges.length,
      fatherLastAvg: average(fatherLastAges),
      fatherLastN: fatherLastAges.length,
      avgSiblingIntervalYears: average(siblingIntervalsYears),
      medianSiblingIntervalYears: median(siblingIntervalsYears),
      siblingIntervalN: siblingIntervalsYears.length,
    };
  });

  // =========================================================================
  // 3. NAMEN, ORTE & BERUFE
  // =========================================================================
  const namesPlaces = computed(() => {
    const onlyExact = filters.value.onlyExactDates;
    const surnameMap = new Map<string, string[]>();
    const givenMap = new Map<string, string[]>();
    const birthPlaceMap = new Map<string, string[]>();
    const deathPlaceMap = new Map<string, string[]>();
    const marriagePlaceMap = new Map<string, string[]>();
    const occuMap = new Map<string, string[]>();

    const surnameByCentury = new Map<string, Map<number, string[]>>();
    const givenByCentury = new Map<string, Map<number, string[]>>();
    const allCenturies = new Set<number>();

    const seenMarriagePlaces = new Set<string>();

    for (const p of filteredPersons.value) {
      const dates = parsedDatesById.value.get(p.id);
      const birthCent =
        dates && isDateUsable(dates.birth, onlyExact) && dates.birth.year !== null
          ? getCentury(dates.birth.year)
          : null;
      if (birthCent !== null) allCenturies.add(birthCent);

      const sn = (p.surname ?? '').trim();
      if (sn) {
        if (!surnameMap.has(sn)) surnameMap.set(sn, []);
        surnameMap.get(sn)!.push(p.id);
        if (birthCent !== null) {
          if (!surnameByCentury.has(sn)) surnameByCentury.set(sn, new Map());
          const cMap = surnameByCentury.get(sn)!;
          if (!cMap.has(birthCent)) cMap.set(birthCent, []);
          cMap.get(birthCent)!.push(p.id);
        }
      }

      const gnRaw = (p.given_name ?? '').trim();
      if (gnRaw) {
        // Count first given name as primary given name for cleaner genealogy trends
        const firstGiven = gnRaw.split(/\s+/)[0];
        if (firstGiven) {
          if (!givenMap.has(firstGiven)) givenMap.set(firstGiven, []);
          givenMap.get(firstGiven)!.push(p.id);
          if (birthCent !== null) {
            if (!givenByCentury.has(firstGiven)) givenByCentury.set(firstGiven, new Map());
            const cMap = givenByCentury.get(firstGiven)!;
            if (!cMap.has(birthCent)) cMap.set(birthCent, []);
            cMap.get(birthCent)!.push(p.id);
          }
        }
      }

      const bp = (p.birth_place ?? '').trim();
      if (bp) {
        if (!birthPlaceMap.has(bp)) birthPlaceMap.set(bp, []);
        birthPlaceMap.get(bp)!.push(p.id);
      }

      const dp = (p.death_place ?? '').trim();
      if (dp) {
        if (!deathPlaceMap.has(dp)) deathPlaceMap.set(dp, []);
        deathPlaceMap.get(dp)!.push(p.id);
      }

      for (const sp of p.spouses ?? []) {
        const pairKey = [p.id, sp.id].sort().join('__');
        if (!seenMarriagePlaces.has(pairKey)) {
          seenMarriagePlaces.add(pairKey);
          const mp = (sp.place ?? '').trim();
          if (mp) {
            if (!marriagePlaceMap.has(mp)) marriagePlaceMap.set(mp, []);
            marriagePlaceMap.get(mp)!.push(p.id);
          }
        }
      }

      const occu = String(p.gedcom_extra?.OCCU?._val ?? '').trim();
      if (occu) {
        if (!occuMap.has(occu)) occuMap.set(occu, []);
        occuMap.get(occu)!.push(p.id);
      }
    }

    const toTopBuckets = (map: Map<string, string[]>, limit = 12): StatBucket[] =>
      Array.from(map.entries())
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([label, ids]) => ({
          key: label,
          label,
          value: ids.length,
          personIds: ids,
        }));

    const sortedCenturies = Array.from(allCenturies).sort((a, b) => a - b);

    const buildTrendSeries = (
      topBuckets: StatBucket[],
      byCentury: Map<string, Map<number, string[]>>
    ): LineSeries[] =>
      topBuckets.slice(0, 5).map((b) => {
        const cMap = byCentury.get(b.label) ?? new Map<number, string[]>();
        return {
          key: b.key,
          label: b.label,
          points: sortedCenturies.map((c) => {
            const ids = cMap.get(c) ?? [];
            return {
              xKey: String(c),
              xLabel: `${c}.`,
              value: ids.length,
              n: ids.length,
              personIds: ids,
            };
          }),
        };
      });

    const topSurnames = toTopBuckets(surnameMap, 12);
    const topGivenNames = toTopBuckets(givenMap, 12);

    return {
      uniqueSurnames: surnameMap.size,
      uniqueGivenNames: givenMap.size,
      topSurnames,
      topGivenNames,
      surnameTrends: buildTrendSeries(topSurnames, surnameByCentury),
      givenNameTrends: buildTrendSeries(topGivenNames, givenByCentury),
      topBirthPlaces: toTopBuckets(birthPlaceMap, 10),
      topDeathPlaces: toTopBuckets(deathPlaceMap, 10),
      topMarriagePlaces: toTopBuckets(marriagePlaceMap, 10),
      topOccupations: toTopBuckets(occuMap, 12),
      occupationN: Array.from(occuMap.values()).reduce((a, b) => a + b.length, 0),
    };
  });

  // =========================================================================
  // 4. STRUKTUR & DATENQUALITÄT
  // =========================================================================
  const qualityStructure = computed(() => {
    const onlyExact = filters.value.onlyExactDates;
    const total = filteredPersons.value.length;

    const missingBirthDate: string[] = [];
    const missingBirthPlace: string[] = [];
    const missingDeathDate: string[] = [];
    const missingDeathPlace: string[] = [];
    const missingSex: string[] = [];
    const missingParents: string[] = [];

    const centuryCounts = new Map<number, string[]>();
    let earliest: { year: number; person: Person } | null = null;
    let latest: { year: number; person: Person } | null = null;

    const targetProbandId =
      filters.value.probandId !== 'all'
        ? filters.value.probandId
        : activeProbandTab.value ?? rootAncestors.value[0]?.person_id ?? null;

    const generationBucketsMap = new Map<number, string[]>();

    for (const p of filteredPersons.value) {
      if (!(p.birth_date ?? '').trim()) missingBirthDate.push(p.id);
      if (!(p.birth_place ?? '').trim()) missingBirthPlace.push(p.id);
      if (!(p.death_date ?? '').trim()) missingDeathDate.push(p.id);
      if (!(p.death_place ?? '').trim()) missingDeathPlace.push(p.id);
      if (normalizeSex(p.sex) === 'U') missingSex.push(p.id);
      if (!p.father_id && !p.mother_id && (p.parent_ids?.length ?? 0) === 0) {
        missingParents.push(p.id);
      }

      const dates = parsedDatesById.value.get(p.id);
      const bYear = dates && isDateUsable(dates.birth, onlyExact) ? dates.birth.year : null;
      const dYear = dates && isDateUsable(dates.death, onlyExact) ? dates.death.year : null;
      const refYear = bYear ?? dYear;

      if (refYear !== null) {
        const c = getCentury(refYear);
        if (!centuryCounts.has(c)) centuryCounts.set(c, []);
        centuryCounts.get(c)!.push(p.id);

        if (!earliest || refYear < earliest.year) earliest = { year: refYear, person: p };
        if (!latest || refYear > latest.year) latest = { year: refYear, person: p };
      }

      if (targetProbandId && p.proband_data?.[targetProbandId]) {
        const gen = p.proband_data[targetProbandId].generation;
        if (!generationBucketsMap.has(gen)) generationBucketsMap.set(gen, []);
        generationBucketsMap.get(gen)!.push(p.id);
      }
    }

    const completenessBuckets: StatBucket[] = [
      {
        key: 'birth_date',
        label: 'birth_date',
        value: total > 0 ? ((total - missingBirthDate.length) / total) * 100 : 0,
        personIds: missingBirthDate,
        extra: { present: total - missingBirthDate.length, missing: missingBirthDate.length },
      },
      {
        key: 'birth_place',
        label: 'birth_place',
        value: total > 0 ? ((total - missingBirthPlace.length) / total) * 100 : 0,
        personIds: missingBirthPlace,
        extra: { present: total - missingBirthPlace.length, missing: missingBirthPlace.length },
      },
      {
        key: 'death_date',
        label: 'death_date',
        value: total > 0 ? ((total - missingDeathDate.length) / total) * 100 : 0,
        personIds: missingDeathDate,
        extra: { present: total - missingDeathDate.length, missing: missingDeathDate.length },
      },
      {
        key: 'death_place',
        label: 'death_place',
        value: total > 0 ? ((total - missingDeathPlace.length) / total) * 100 : 0,
        personIds: missingDeathPlace,
        extra: { present: total - missingDeathPlace.length, missing: missingDeathPlace.length },
      },
      {
        key: 'sex',
        label: 'sex',
        value: total > 0 ? ((total - missingSex.length) / total) * 100 : 0,
        personIds: missingSex,
        extra: { present: total - missingSex.length, missing: missingSex.length },
      },
      {
        key: 'parents',
        label: 'parents',
        value: total > 0 ? ((total - missingParents.length) / total) * 100 : 0,
        personIds: missingParents,
        extra: { present: total - missingParents.length, missing: missingParents.length },
      },
    ];

    const generationBuckets: StatBucket[] = Array.from(generationBucketsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([gen, ids]) => ({
        key: String(gen),
        label: `Gen. ${gen}`,
        value: ids.length,
        personIds: ids,
      }));

    const personsByCentury: StatBucket[] = Array.from(centuryCounts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([c, ids]) => ({
        key: String(c),
        label: `${c}.`,
        value: ids.length,
        personIds: ids,
      }));

    // Implex (Ahnenverlust) calculation for targetProbandId (or first person with parents)
    const implexRows: ImplexGenerationRow[] = [];
    const implexRootId = targetProbandId;
    if (implexRootId && personById.value.has(implexRootId)) {
      let currentGenSlots: string[] = [implexRootId];
      for (let g = 1; g <= 12; g++) {
        const nextGenSlots: string[] = [];
        for (const pid of currentGenSlots) {
          const person = personById.value.get(pid);
          if (!person) continue;
          if (person.father_id) nextGenSlots.push(person.father_id);
          if (person.mother_id) nextGenSlots.push(person.mother_id);
          if (!person.father_id && !person.mother_id && person.parent_ids?.length) {
            for (const parentId of person.parent_ids.slice(0, 2)) {
              nextGenSlots.push(parentId);
            }
          }
        }
        if (nextGenSlots.length === 0) break;

        const counts = new Map<string, number>();
        for (const aid of nextGenSlots) {
          counts.set(aid, (counts.get(aid) ?? 0) + 1);
        }
        const duplicateIds = Array.from(counts.entries())
          .filter(([, cnt]) => cnt > 1)
          .map(([aid]) => aid);

        const occupiedSlots = nextGenSlots.length;
        const uniqueCount = counts.size;
        const duplicateCount = occupiedSlots - uniqueCount;
        const lossPercent = occupiedSlots > 0 ? (duplicateCount / occupiedSlots) * 100 : 0;

        implexRows.push({
          generation: g,
          theoretical: Math.pow(2, g),
          occupiedSlots,
          uniqueCount,
          duplicateCount,
          lossPercent,
          duplicatePersonIds: duplicateIds,
        });

        currentGenSlots = nextGenSlots;
      }
    }

    const totalCoreFields = total * 2;
    const presentCoreFields =
      totalCoreFields - missingBirthDate.length - missingDeathDate.length;
    const coreCompletenessPct =
      totalCoreFields > 0 ? (presentCoreFields / totalCoreFields) * 100 : 0;

    return {
      total,
      coreCompletenessPct,
      completenessBuckets,
      generationBuckets,
      maxGeneration: generationBuckets.length > 0 ? Math.max(...generationBucketsMap.keys()) : 0,
      personsByCentury,
      earliest,
      latest,
      implexProbandName: implexRootId ? formatPersonName(personById.value.get(implexRootId)) : null,
      implexRows,
    };
  });

  function resetFilters() {
    filters.value = {
      probandId: 'all',
      sex: 'all',
      yearFrom: null,
      yearTo: null,
      onlyExactDates: false,
      familyGrouping: 'couple',
    };
  }

  return {
    filters,
    resetFilters,
    personById,
    filteredPersons,
    demographics,
    families,
    namesPlaces,
    qualityStructure,
  };
}

"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useMemo, useRef, useState } from "react";
import { splitTravelPlaceName } from "@/lib/travel-place-name";
import type {
  TravelLinkPlace,
  TravelLinkSource,
  Trip,
  TripAccommodation,
  TripFood,
  TripPlace,
} from "../oip-types";

type ThemeMode = "light" | "dark";
type MapStatus =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "unlocated"
  | "unconfigured";
type MapEntryKind = "accommodation" | "food" | "place";
type MapEntrySource = "trip" | "link";

type MapEntry = {
  countryCode?: string | null;
  detail: string;
  fallbackDestination?: string;
  href?: string | null;
  id: string;
  kind: MapEntryKind;
  query: string;
  source: MapEntrySource;
  title: string;
  translatedTitle?: string | null;
};

type MapLocationGroup = {
  entries: MapEntry[];
  query: string;
  source: MapEntrySource;
};

const DEFAULT_CENTER = { lat: 20, lng: 15 };
const WATERDROP_PATH =
  "M 0,-22 C -12,-22 -20,-13 -20,-2 C -20,11 -8,21 0,29 C 8,21 20,11 20,-2 C 20,-13 12,-22 0,-22 Z";

const MARKER_KIND_META: Record<
  MapEntryKind,
  { icon: string; label: string }
> = {
  accommodation: { icon: "🏨", label: "숙소" },
  food: { icon: "🍴", label: "식당·음식" },
  place: { icon: "📍", label: "일반 장소" },
};

const MARKER_SOURCE_META: Record<
  MapEntrySource,
  { color: string; label: string }
> = {
  trip: { color: "#ffffff", label: "여행 연결" },
  link: { color: "#fde398", label: "링크 분석" },
};

const MARKER_KIND_ORDER: MapEntryKind[] = [
  "accommodation",
  "food",
  "place",
];
const MARKER_SOURCE_ORDER: MapEntrySource[] = ["trip", "link"];
const GENERIC_LOCATION_TYPES = new Set([
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "locality",
  "postal_code",
  "political",
]);

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1d252d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a9b3bf" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1d252d" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#3c4854" }],
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#202b29" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#25302e" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#83908b" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#2e3943" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#98a3ad" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#28343e" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#101a22" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#687783" }],
  },
];

let configuredApiKey: string | null = null;

function configureMapsApi(apiKey: string) {
  if (configuredApiKey === apiKey) return;
  if (configuredApiKey) {
    throw new Error("Google Maps API가 이미 다른 키로 초기화되었습니다.");
  }

  setOptions({
    authReferrerPolicy: "origin",
    key: apiKey,
    language: "ko",
    region: "KR",
    v: "weekly",
  });
  configuredApiKey = apiKey;
}

function linkPlaceKind(category: string): MapEntryKind {
  if (/숙소|호텔|리조트|호스텔|게스트하우스|hotel|resort|hostel/i.test(category)) {
    return "accommodation";
  }
  return /식당|음식|맛집|카페|디저트|베이커리|술집|이자카야|야키니쿠|라멘|스시|레스토랑|food|restaurant|cafe|dining|bakery|dessert|bar/i.test(
    category,
  )
    ? "food"
    : "place";
}

function groupEntriesByQuery(entries: MapEntry[]) {
  const groups = new Map<string, MapLocationGroup>();
  entries.forEach((entry) => {
    const query = entry.query.trim();
    if (!query) return;
    const key = `${entry.source}:${query.toLocaleLowerCase("ko-KR")}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
      return;
    }
    groups.set(key, { entries: [entry], query, source: entry.source });
  });
  return [...groups.values()];
}

function normalizedLocationText(value: string) {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/여행/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function resultTextMatchesDestination(
  destination: string,
  result: google.maps.GeocoderResult,
) {
  const expected = normalizedLocationText(destination);
  if (!expected) return false;
  const resultText = normalizedLocationText(
    [
      result.formatted_address,
      ...result.address_components.flatMap((component) => [
        component.long_name,
        component.short_name,
      ]),
    ].join(" "),
  );
  return resultText.includes(expected);
}

function isSpecificPlaceResult(result: google.maps.GeocoderResult) {
  return (
    !result.partial_match &&
    result.types.some((type) => !GENERIC_LOCATION_TYPES.has(type))
  );
}

async function fallbackResultMatchesDestination(
  geocoder: google.maps.Geocoder,
  entry: MapEntry,
  result: google.maps.GeocoderResult,
  destinationBoundsCache: Map<string, google.maps.LatLngBounds | null>,
) {
  if (!entry.fallbackDestination || !isSpecificPlaceResult(result)) {
    return false;
  }
  if (resultTextMatchesDestination(entry.fallbackDestination, result)) {
    return true;
  }

  const cacheKey = `${entry.countryCode ?? ""}:${entry.fallbackDestination}`;
  let destinationBounds = destinationBoundsCache.get(cacheKey);
  if (destinationBounds === undefined) {
    try {
      const response = await geocoder.geocode({
        address: entry.fallbackDestination,
        language: "ko",
        ...(entry.countryCode
          ? { componentRestrictions: { country: entry.countryCode } }
          : {}),
      });
      const destinationResult = response.results[0];
      destinationBounds = destinationResult
        ? destinationResult.geometry.bounds ??
          destinationResult.geometry.viewport ??
          null
        : null;
    } catch {
      destinationBounds = null;
    }
    destinationBoundsCache.set(cacheKey, destinationBounds);
  }

  return destinationBounds?.contains(result.geometry.location) ?? false;
}

function infoWindowHeader(group: MapLocationGroup) {
  const header = document.createElement("div");
  header.className = "travel-map-info-title";
  const title = document.createElement("strong");
  const translatedTitle = document.createElement("small");
  const singleEntry = group.entries.length === 1 ? group.entries[0] : null;
  title.textContent = singleEntry?.title ?? group.query;
  header.append(title);
  if (singleEntry?.translatedTitle) {
    translatedTitle.textContent = singleEntry.translatedTitle;
    header.append(translatedTitle);
  }
  return header;
}

function infoWindowContent(group: MapLocationGroup) {
  const content = document.createElement("div");
  content.className = "travel-map-info";

  const list = document.createElement("div");
  list.className = "travel-map-info-list";
  group.entries.forEach((entry) => {
    const item = document.createElement("span");
    const entryTitle = document.createElement("b");
    const detail = document.createElement("small");
    entryTitle.textContent =
      group.entries.length === 1
        ? `${MARKER_KIND_META[entry.kind].icon} ${entry.detail}`
        : `${MARKER_KIND_META[entry.kind].icon} ${entry.title}`;
    if (group.entries.length > 1 && entry.translatedTitle) {
      const translation = document.createElement("small");
      translation.className = "travel-map-info-translation";
      translation.textContent = entry.translatedTitle;
      item.append(entryTitle, translation);
    } else {
      item.append(entryTitle);
    }
    detail.textContent = entry.fallbackDestination
      ? `이름으로 자동 검색 · ${entry.fallbackDestination}`
      : entry.query;
    item.append(detail);

    if (entry.href) {
      const link = document.createElement("a");
      link.href = entry.href;
      link.rel = "noreferrer";
      link.target = "_blank";
      link.textContent = "원본 링크 열기";
      item.append(link);
    }

    list.append(item);
  });
  content.append(list);
  return content;
}

function makeMarkerIcon(source: MapEntrySource) {
  return {
    anchor: new google.maps.Point(0, 29),
    fillColor: MARKER_SOURCE_META[source].color,
    fillOpacity: 0.8,
    labelOrigin: new google.maps.Point(0, -2),
    path: WATERDROP_PATH,
    scale: 0.60,
    strokeColor: source === "trip" ? "#73829a" : "#ffffff",
    strokeOpacity: source === "trip" ? 0.78 : 0.96,
    strokeWeight: 2.1,
  } satisfies google.maps.Symbol;
}

function UnlocatedDialog({
  entries,
  onClose,
}: {
  entries: MapEntry[];
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="travel-map-unlocated-title"
        aria-modal="true"
        className="modal-card travel-map-unlocated-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <h2 id="travel-map-unlocated-title">위치를 찾지 못한 항목</h2>
            <p>검색어를 더 구체적인 상호명이나 주소로 수정해 주세요.</p>
          </div>
          <button
            aria-label="닫기"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="travel-map-unlocated-list">
          {entries.map((entry) => (
            <article key={`${entry.source}:${entry.id}`}>
              <span aria-hidden="true">
                {MARKER_KIND_META[entry.kind].icon}
              </span>
              <div>
                <strong>{entry.title}</strong>
                {entry.translatedTitle ? (
                  <span className="travel-map-unlocated-translation">
                    {entry.translatedTitle}
                  </span>
                ) : null}
                <small>
                  {MARKER_SOURCE_META[entry.source].label} · {entry.detail}
                </small>
                <p>
                  {entry.fallbackDestination ? "자동 검색" : "입력 위치"}: {" "}
                  {entry.query}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function TravelMap({
  accommodations = [],
  apiKey,
  emptyDetail = "상세 위치를 입력하면 이곳에 마커가 생깁니다.",
  emptyTitle = "표시할 상세 위치가 없습니다",
  foods = [],
  linkPlaces = [],
  linkSources = [],
  places = [],
  theme,
  trips = [],
}: {
  accommodations?: TripAccommodation[];
  apiKey: string;
  emptyDetail?: string;
  emptyTitle?: string;
  foods?: TripFood[];
  linkPlaces?: TravelLinkPlace[];
  linkSources?: TravelLinkSource[];
  places?: TripPlace[];
  theme: ThemeMode;
  trips?: Trip[];
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [unlocatedEntries, setUnlocatedEntries] = useState<MapEntry[]>([]);
  const [unlocatedDialogOpen, setUnlocatedDialogOpen] = useState(false);

  const locationGroups = useMemo(() => {
    const visibleSources = new Map(
      linkSources
        .filter((source) => source.is_map_visible)
        .map((source) => [source.id, source]),
    );
    const tripsById = new Map(trips.map((trip) => [trip.id, trip]));
    const entries: MapEntry[] = [
      ...accommodations.flatMap((item) =>
        item.address?.trim()
          ? [
              {
                detail: "숙소",
                id: item.id,
                kind: "accommodation" as const,
                query: item.address.trim(),
                source: "trip" as const,
                title: item.name,
              },
            ]
          : [],
      ),
      ...foods.flatMap((item) =>
        item.location?.trim()
          ? [
              {
                detail: `먹을 것 · ${item.item_type}`,
                href: item.link,
                id: item.id,
                kind: "food" as const,
                query: item.location.trim(),
                source: "trip" as const,
                title: item.name,
              },
            ]
          : [],
      ),
      ...places.flatMap((item) => {
        const explicitLocation = item.location?.trim();
        const trip = tripsById.get(item.trip_id);
        const destination = trip?.destination.trim();
        const query = explicitLocation ||
          (destination ? `${item.name}, ${destination}` : "");
        return query
          ? [
              {
                countryCode: trip?.country_code,
                detail: `갈 곳 · ${item.category}`,
                fallbackDestination: explicitLocation
                  ? undefined
                  : destination,
                href: item.link,
                id: item.id,
                kind: "place" as const,
                query,
                source: "trip" as const,
                title: item.name,
              },
            ]
          : [];
      }),
      ...linkPlaces.flatMap((place) => {
        const source = visibleSources.get(place.source_id);
        const { originalName, translatedName } = splitTravelPlaceName(
          place.name,
        );
        return source
          ? [
              {
                detail: `AI 링크 · ${place.category}`,
                href: source.url,
                id: place.id,
                kind: linkPlaceKind(place.category),
                query: place.location_query,
                source: "link" as const,
                title: originalName,
                translatedTitle: translatedName,
              },
            ]
          : [];
      }),
    ];
    return groupEntriesByQuery(entries);
  }, [accommodations, foods, linkPlaces, linkSources, places, trips]);

  const visibleKinds = useMemo(() => {
    const kinds = new Set<MapEntryKind>();
    locationGroups.forEach((group) =>
      group.entries.forEach((entry) => kinds.add(entry.kind)),
    );
    return MARKER_KIND_ORDER.filter((kind) => kinds.has(kind));
  }, [locationGroups]);

  const visibleSources = useMemo(() => {
    const sources = new Set(
      locationGroups.map((group) => group.source),
    );
    return MARKER_SOURCE_ORDER.filter((source) => sources.has(source));
  }, [locationGroups]);

  useEffect(() => {
    if (!apiKey) return;
    if (!mapElementRef.current) return;

    let isCancelled = false;
    const markers: google.maps.Marker[] = [];
    const listeners: google.maps.MapsEventListener[] = [];

    async function renderMap() {
      setStatus("loading");
      setUnlocatedEntries([]);
      setUnlocatedDialogOpen(false);
      configureMapsApi(apiKey);
      const [{ Map, InfoWindow }, { Geocoder }, { Marker }] =
        await Promise.all([
          importLibrary("maps"),
          importLibrary("geocoding"),
          importLibrary("marker"),
        ]);
      if (isCancelled || !mapElementRef.current) return;

      const map = new Map(mapElementRef.current, {
        backgroundColor: theme === "dark" ? "#1a2027" : "#e8eee9",
        center: DEFAULT_CENTER,
        clickableIcons: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
        mapTypeControl: false,
        streetViewControl: false,
        styles: theme === "dark" ? DARK_MAP_STYLES : undefined,
        zoom: locationGroups.length ? 3 : 2,
        zoomControl: true,
      });

      if (!locationGroups.length) {
        if (!isCancelled) setStatus("empty");
        return;
      }

      const geocoder = new Geocoder();
      const infoWindow = new InfoWindow();
      const destinationBoundsCache = new globalThis.Map<
        string,
        google.maps.LatLngBounds | null
      >();
      const located: Array<{
        group: MapLocationGroup;
        location: google.maps.LatLngLiteral;
      }> = [];
      const failedEntries: MapEntry[] = [];

      for (const group of locationGroups) {
        try {
          const countryCode = group.entries[0].countryCode;
          const response = await geocoder.geocode({
            address: group.query,
            language: "ko",
            ...(countryCode
              ? { componentRestrictions: { country: countryCode } }
              : {}),
          });
          const result = response.results[0];
          if (!result) {
            failedEntries.push(...group.entries);
            continue;
          }

          const acceptedEntries: MapEntry[] = [];
          for (const entry of group.entries) {
            const isAccepted = entry.fallbackDestination
              ? await fallbackResultMatchesDestination(
                  geocoder,
                  entry,
                  result,
                  destinationBoundsCache,
                )
              : true;
            if (isAccepted) acceptedEntries.push(entry);
            else failedEntries.push(entry);
          }

          if (acceptedEntries.length) {
            located.push({
              group: { ...group, entries: acceptedEntries },
              location: result.geometry.location.toJSON(),
            });
          }
        } catch {
          failedEntries.push(...group.entries);
        }
        if (isCancelled) return;
      }

      located.forEach(({ group, location }) => {
        const kind = group.entries[0].kind;
        const marker = new Marker({
          icon: makeMarkerIcon(group.source),
          label: {
            color: "#ffffff",
            fontSize: "13px",
            fontWeight: "700",
            text: MARKER_KIND_META[kind].icon,
          },
          map,
          position: location,
          title:
            group.entries.length === 1 ? group.entries[0].title : group.query,
        });
        markers.push(marker);
        listeners.push(
          marker.addListener("click", () => {
            infoWindow.setHeaderContent(infoWindowHeader(group));
            infoWindow.setContent(infoWindowContent(group));
            infoWindow.open({ anchor: marker, map });
          }),
        );
      });

      if (located.length === 1) {
        map.setCenter(located[0].location);
        map.setZoom(15);
      } else if (located.length > 1) {
        const latitudes = located.map(({ location }) => location.lat);
        const longitudes = located.map(({ location }) => location.lng);
        map.fitBounds(
          {
            east: Math.max(...longitudes),
            north: Math.max(...latitudes),
            south: Math.min(...latitudes),
            west: Math.min(...longitudes),
          },
          54,
        );
        const fitListener = map.addListener("idle", () => {
          if ((map.getZoom() ?? 0) > 16) map.setZoom(16);
          fitListener.remove();
        });
        listeners.push(fitListener);
      }

      if (!isCancelled) {
        setUnlocatedEntries(failedEntries);
        setStatus(located.length ? "ready" : "unlocated");
      }
    }

    void renderMap().catch(() => {
      if (!isCancelled) setStatus("error");
    });

    return () => {
      isCancelled = true;
      listeners.forEach((listener) => listener.remove());
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [apiKey, locationGroups, theme]);

  const visibleStatus: MapStatus = apiKey ? status : "unconfigured";
  const statusCopy =
    visibleStatus === "unconfigured"
      ? {
          icon: "🗺️",
          title: "Google Maps 연결이 필요합니다",
          detail: "API 키를 설정하면 저장된 상세 위치가 지도에 표시됩니다.",
        }
      : visibleStatus === "error"
        ? {
            icon: "!",
            title: "지도를 불러오지 못했습니다",
            detail: "API 키와 Google Maps 설정을 확인해 주세요.",
          }
        : visibleStatus === "unlocated"
          ? {
              icon: "?",
              title: "입력한 위치를 지도에서 찾지 못했습니다",
              detail: "아래 안내에서 찾지 못한 항목을 확인해 주세요.",
            }
          : visibleStatus === "empty"
            ? {
                icon: "📍",
                title: emptyTitle,
                detail: emptyDetail,
              }
            : {
                icon: "",
                title: "여행 지도를 불러오는 중",
                detail: "저장된 상세 위치를 지도에서 찾고 있습니다.",
              };

  return (
    <div className="travel-map-block">
      <section className="travel-map-panel" aria-label="여행 지도">
        <div
          aria-label="저장된 숙소와 여행지를 표시하는 Google 지도"
          className="travel-map-canvas"
          ref={mapElementRef}
          role="region"
        />
        {visibleStatus === "ready" &&
        (visibleSources.length || visibleKinds.length) ? (
          <div className="travel-map-legend" aria-label="지도 마커 범례">
            <div className="travel-map-legend-sources">
              {visibleSources.map((source) => (
                <span key={source}>
                  <i
                    aria-hidden="true"
                    style={{
                      backgroundColor: MARKER_SOURCE_META[source].color,
                      borderColor: source === "trip" ? "#73829a" : "#ffffff",
                    }}
                  />
                  {MARKER_SOURCE_META[source].label}
                </span>
              ))}
            </div>
            <div className="travel-map-legend-kinds">
              {visibleKinds.map((kind) => (
                <span key={kind}>
                  {MARKER_KIND_META[kind].icon} {MARKER_KIND_META[kind].label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {visibleStatus !== "ready" ? (
          <div
            className={`travel-map-status travel-map-status--${visibleStatus}`}
          >
            {visibleStatus === "loading" ? (
              <span aria-hidden="true" className="travel-map-spinner" />
            ) : (
              <span aria-hidden="true" className="travel-map-status-icon">
                {statusCopy.icon}
              </span>
            )}
            <strong>{statusCopy.title}</strong>
            <small>{statusCopy.detail}</small>
          </div>
        ) : null}
      </section>

      {unlocatedEntries.length ? (
        <button
          className="travel-map-unlocated-button"
          onClick={() => setUnlocatedDialogOpen(true)}
          type="button"
        >
          <span aria-hidden="true">!</span>
          위치를 찾지 못한 항목 {unlocatedEntries.length}개
          <small>확인 ›</small>
        </button>
      ) : null}

      {unlocatedDialogOpen ? (
        <UnlocatedDialog
          entries={unlocatedEntries}
          onClose={() => setUnlocatedDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

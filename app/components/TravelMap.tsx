"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  TravelLinkPlace,
  TravelLinkSource,
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
type MapEntryKind = "accommodation" | "food" | "place" | "link";

type MapEntry = {
  detail: string;
  href?: string | null;
  id: string;
  kind: MapEntryKind;
  query: string;
  title: string;
};

type MapLocationGroup = {
  entries: MapEntry[];
  query: string;
};

const DEFAULT_CENTER = { lat: 20, lng: 15 };

const MARKER_META: Record<
  MapEntryKind,
  { color: string; icon: string; label: string }
> = {
  accommodation: { color: "#4285f4", icon: "🏨", label: "숙소" },
  food: { color: "#f59e0b", icon: "🍴", label: "먹을 것" },
  place: { color: "#8b5cf6", icon: "📍", label: "갈 곳" },
  link: { color: "#4d7667", icon: "✨", label: "AI 링크" },
};

const MARKER_KIND_ORDER: MapEntryKind[] = [
  "accommodation",
  "food",
  "place",
  "link",
];

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

function groupEntriesByQuery(entries: MapEntry[]) {
  const groups = new Map<string, MapLocationGroup>();
  entries.forEach((entry) => {
    const query = entry.query.trim();
    if (!query) return;
    const key = query.toLocaleLowerCase("ko-KR");
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
      return;
    }
    groups.set(key, { entries: [entry], query });
  });
  return [...groups.values()];
}

function infoWindowContent(group: MapLocationGroup) {
  const content = document.createElement("div");
  content.className = "travel-map-info";

  const title = document.createElement("strong");
  title.textContent =
    group.entries.length === 1 ? group.entries[0].title : group.query;
  content.append(title);

  const list = document.createElement("div");
  list.className = "travel-map-info-list";
  group.entries.forEach((entry) => {
    const item = document.createElement("span");
    const entryTitle = document.createElement("b");
    const detail = document.createElement("small");
    entryTitle.textContent = `${MARKER_META[entry.kind].icon} ${entry.title}`;
    detail.textContent = `${entry.detail} · ${entry.query}`;
    item.append(entryTitle, detail);

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

function makeMarkerIcon(kind: MapEntryKind) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: MARKER_META[kind].color,
    fillOpacity: 1,
    scale: 18,
    strokeColor: "#ffffff",
    strokeWeight: 2,
  } satisfies google.maps.Symbol;
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
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [unlocatedCount, setUnlocatedCount] = useState(0);

  const locationGroups = useMemo(() => {
    const visibleSources = new Map(
      linkSources
        .filter((source) => source.is_map_visible)
        .map((source) => [source.id, source]),
    );
    const entries: MapEntry[] = [
      ...accommodations.flatMap((item) =>
        item.address?.trim()
          ? [
              {
                detail: "숙소",
                id: item.id,
                kind: "accommodation" as const,
                query: item.address.trim(),
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
                title: item.name,
              },
            ]
          : [],
      ),
      ...places.flatMap((item) =>
        item.location?.trim()
          ? [
              {
                detail: `갈 곳 · ${item.category}`,
                href: item.link,
                id: item.id,
                kind: "place" as const,
                query: item.location.trim(),
                title: item.name,
              },
            ]
          : [],
      ),
      ...linkPlaces.flatMap((place) => {
        const source = visibleSources.get(place.source_id);
        return source
          ? [
              {
                detail: `AI 링크 · ${place.category}`,
                href: source.url,
                id: place.id,
                kind: "link" as const,
                query: place.location_query,
                title: place.name,
              },
            ]
          : [];
      }),
    ];
    return groupEntriesByQuery(entries);
  }, [accommodations, foods, linkPlaces, linkSources, places]);

  const visibleKinds = useMemo(() => {
    const kinds = new Set<MapEntryKind>();
    locationGroups.forEach((group) =>
      group.entries.forEach((entry) => kinds.add(entry.kind)),
    );
    return MARKER_KIND_ORDER.filter((kind) => kinds.has(kind));
  }, [locationGroups]);

  useEffect(() => {
    if (!apiKey) return;
    if (!mapElementRef.current) return;

    let isCancelled = false;
    const markers: google.maps.Marker[] = [];
    const listeners: google.maps.MapsEventListener[] = [];

    async function renderMap() {
      setStatus("loading");
      setUnlocatedCount(0);
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
      const located: Array<{
        group: MapLocationGroup;
        location: google.maps.LatLngLiteral;
      }> = [];

      for (const group of locationGroups) {
        try {
          const response = await geocoder.geocode({
            address: group.query,
            language: "ko",
          });
          const location = response.results[0]?.geometry.location.toJSON();
          if (location) located.push({ group, location });
        } catch {
          // An ambiguous location should not prevent the remaining entries from rendering.
        }
        if (isCancelled) return;
      }

      located.forEach(({ group, location }) => {
        const kind = group.entries[0].kind;
        const marker = new Marker({
          icon: makeMarkerIcon(kind),
          label: {
            color: "#ffffff",
            fontSize: "15px",
            fontWeight: "700",
            text: MARKER_META[kind].icon,
          },
          map,
          position: location,
          title:
            group.entries.length === 1 ? group.entries[0].title : group.query,
        });
        markers.push(marker);
        listeners.push(
          marker.addListener("click", () => {
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
        setUnlocatedCount(locationGroups.length - located.length);
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
              detail: "상호명과 도시 또는 상세 주소를 확인해 주세요.",
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
    <section className="travel-map-panel" aria-label="여행 지도">
      <div
        aria-label="저장된 숙소와 여행지를 표시하는 Google 지도"
        className="travel-map-canvas"
        ref={mapElementRef}
        role="region"
      />
      {visibleStatus === "ready" && visibleKinds.length ? (
        <div className="travel-map-legend" aria-label="지도 마커 범례">
          {visibleKinds.map((kind) => (
            <span key={kind}>
              <i
                aria-hidden="true"
                style={{ backgroundColor: MARKER_META[kind].color }}
              >
                {MARKER_META[kind].icon}
              </i>
              {MARKER_META[kind].label}
            </span>
          ))}
        </div>
      ) : null}
      {visibleStatus !== "ready" ? (
        <div className={`travel-map-status travel-map-status--${visibleStatus}`}>
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
      {visibleStatus === "ready" && unlocatedCount ? (
        <span className="travel-map-notice">
          위치를 찾지 못한 항목 {unlocatedCount}개
        </span>
      ) : null}
    </section>
  );
}

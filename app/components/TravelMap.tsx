"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip } from "../oip-types";

type ThemeMode = "light" | "dark";
type MapStatus =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "unlocated"
  | "unconfigured";

type DestinationGroup = {
  countryCode?: string | null;
  destination: string;
  trips: Trip[];
};

const DEFAULT_CENTER = { lat: 20, lng: 15 };

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

function formatTripPeriod(trip: Trip) {
  const format = (value: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
      timeZone: "Asia/Seoul",
    }).format(new Date(`${value}T00:00:00+09:00`));
  return `${format(trip.start_date)} – ${format(trip.end_date)}`;
}

function infoWindowContent(group: DestinationGroup) {
  const content = document.createElement("div");
  content.className = "travel-map-info";

  const destination = document.createElement("strong");
  destination.textContent = group.destination;
  content.append(destination);

  const list = document.createElement("div");
  list.className = "travel-map-info-list";
  group.trips.forEach((trip) => {
    const item = document.createElement("span");
    const title = document.createElement("b");
    const period = document.createElement("small");
    title.textContent = trip.title;
    period.textContent = formatTripPeriod(trip);
    item.append(title, period);
    list.append(item);
  });
  content.append(list);
  return content;
}

async function geocodeDestination(
  geocoder: google.maps.Geocoder,
  group: DestinationGroup,
) {
  const request: google.maps.GeocoderRequest = {
    address: group.destination,
    language: "ko",
    ...(group.countryCode
      ? { componentRestrictions: { country: group.countryCode } }
      : {}),
  };
  const response = await geocoder.geocode(request);
  const location = response.results[0]?.geometry.location.toJSON();
  return location ?? null;
}

function groupTripsByDestination(trips: Trip[]) {
  const groups = new Map<string, DestinationGroup>();
  trips.forEach((trip) => {
    const destination = trip.destination.trim();
    if (!destination) return;
    const key = `${trip.country_code ?? ""}:${destination}`.toLocaleLowerCase(
      "ko-KR",
    );
    const existing = groups.get(key);
    if (existing) {
      existing.trips.push(trip);
      return;
    }
    groups.set(key, {
      countryCode: trip.country_code,
      destination,
      trips: [trip],
    });
  });
  return [...groups.values()];
}

export function TravelMap({
  apiKey,
  theme,
  trips,
}: {
  apiKey: string;
  theme: ThemeMode;
  trips: Trip[];
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [unlocatedCount, setUnlocatedCount] = useState(0);
  const destinationGroups = useMemo(
    () => groupTripsByDestination(trips),
    [trips],
  );

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
        zoom: destinationGroups.length ? 3 : 2,
        zoomControl: true,
      });

      if (!destinationGroups.length) {
        if (!isCancelled) setStatus("empty");
        return;
      }

      const geocoder = new Geocoder();
      const infoWindow = new InfoWindow();
      const located: Array<{
        group: DestinationGroup;
        location: google.maps.LatLngLiteral;
      }> = [];

      for (const group of destinationGroups) {
        try {
          const location = await geocodeDestination(geocoder, group);
          if (location) located.push({ group, location });
        } catch {
          // A single destination should not prevent the remaining trips from rendering.
        }
        if (isCancelled) return;
      }

      located.forEach(({ group, location }) => {
        const marker = new Marker({
          map,
          position: location,
          title: group.destination,
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
        map.setZoom(7);
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
          if ((map.getZoom() ?? 0) > 8) map.setZoom(8);
          fitListener.remove();
        });
        listeners.push(fitListener);
      }

      if (!isCancelled) {
        setUnlocatedCount(destinationGroups.length - located.length);
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
  }, [apiKey, destinationGroups, theme]);

  const visibleStatus: MapStatus = apiKey ? status : "unconfigured";
  const statusCopy =
    visibleStatus === "unconfigured"
      ? {
          icon: "🗺️",
          title: "Google Maps 연결이 필요합니다",
          detail: "API 키를 설정하면 여행지가 지도에 표시됩니다.",
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
              title: "여행지 위치를 찾지 못했습니다",
              detail: "여행지 이름과 Geocoding API 설정을 확인해 주세요.",
            }
        : visibleStatus === "empty"
          ? {
              icon: "📍",
              title: "표시할 여행지가 없습니다",
              detail: "여행지를 추가하면 이곳에 마커가 생깁니다.",
            }
          : {
              icon: "",
              title: "여행 지도를 불러오는 중",
              detail: "등록된 여행지의 위치를 찾고 있습니다.",
            };

  return (
    <section className="travel-map-panel" aria-label="여행 지도">
      <div
        aria-label="등록된 여행지를 표시하는 Google 지도"
        className="travel-map-canvas"
        ref={mapElementRef}
        role="region"
      />
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
          위치를 찾지 못한 여행지 {unlocatedCount}개
        </span>
      ) : null}
    </section>
  );
}

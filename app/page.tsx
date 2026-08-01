import { OipApp } from "./components/OipApp";

export default function Home() {
  return (
    <OipApp
      googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
    />
  );
}

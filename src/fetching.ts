import { RAPID_API_KEY } from "./config.js";
import { FetchError } from "./type.js";

function redact(url: string | URL) {
  const newUrl = new URL(url);
  for (const k of ["appid", "apiKey", "key", "token"]) {
    if (newUrl.searchParams.has(k)) newUrl.searchParams.set(k, "***");
  }
  return newUrl.toString();
}

export async function fetchAPI(url: string | URL, init?: RequestInit, timeout: number = 10_000) {
  const safeUrl = redact(url);
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    throw new FetchError(null, "Error when fetching.", safeUrl, error);
  }
  if (!response.ok) {
    throw new FetchError(response.status, "API responded with error", safeUrl);
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new FetchError(response.status, "Response was not valid JSON", safeUrl, error);
  }
  return data;
}

export async function fetchRapidAPI(url: string | URL, host: string, timeout?: number) {
  const options = {
    method: "GET",
    headers: {
      "x-rapidapi-key": RAPID_API_KEY,
      "x-rapidapi-host": host,
    },
  };
  return await fetchAPI(url, options, timeout);
}

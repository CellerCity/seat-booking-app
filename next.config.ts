import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only. Next blocks cross-origin requests to dev assets by default, so
  // opening the app from a phone on the same WiFi fails without listing the
  // laptop's LAN address here. Has no effect on `next build` or production.
  //
  // This is a DHCP address: if the phone loads a bare, unstyled page after you
  // reconnect to WiFi, the laptop's IP has changed — check `ipconfig` and
  // update this list.
  allowedDevOrigins: ["10.147.213.150", "192.168.137.1"],
};

export default nextConfig;

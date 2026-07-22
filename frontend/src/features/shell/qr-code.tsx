import { QRCodeSVG } from "qrcode.react";

export function QrCode({ value, label }: { value: string; label: string }) {
  return (
    <QRCodeSVG
      value={value}
      title={label}
      role="img"
      aria-label={label}
      level="M"
      marginSize={4}
      className="h-full w-full"
    />
  );
}

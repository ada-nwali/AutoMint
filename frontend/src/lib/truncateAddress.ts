import { useState, useCallback } from "react";

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function fullAddressTitle(address: string): string {
  return address;
}

export function fullAddressAriaLabel(address: string): string {
  return `Full address: ${address}`;
}

export function useCopyToClipboard(address: string) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      fallbackCopy(address);
    }
  }, [address]);

  const fallbackCopy = useCallback((text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, []);

  return { isCopied, handleCopy };
}
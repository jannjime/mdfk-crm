import { notFound } from "next/navigation";
import { WhatsappQrClient } from "@/components/settings/whatsapp-qr-client";
import { isChannelEnabled } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

export default function WhatsappQrSettingsPage() {
  // Sin el canal encendido esta pantalla no existe en esta instancia (ADR-001).
  if (!isChannelEnabled("whatsapp_qr")) notFound();
  return <WhatsappQrClient />;
}

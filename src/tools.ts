import type { ToolDef } from "./types.js";

export const tools: ToolDef[] = [
  {
    name: "create_partner_profile",
    description: "Crée un profil partenaire dans le CRM. Doit être la première étape.",
    parameters: [
      { name: "brand", description: "Nom de la marque (ex: Red Bull)", required: true },
      { name: "contact", description: "Email de contact du partenaire", required: true },
    ],
    execute: async ({ brand, contact }) => {
      const id = `prof_${Date.now()}`;
      return { profileId: id, brand, contact, status: "active" };
    },
    compensate: async ({ profileId }) => {
      return { deleted: true };
    },
  },
  {
    name: "send_agreement",
    description: "Envoie le contrat au partenaire pour signature.",
    parameters: [
      { name: "profileId", description: "ID du profil partenaire", required: true },
      { name: "terms", description: "Termes (ex: 3 posts, 15000€)", required: true },
      { name: "contact", description: "Email d'envoi", required: true },
    ],
    execute: async ({ profileId, terms, contact }) => {
      if (contact && contact.toLowerCase().includes("fail")) {
        throw new Error(`Adresse invalide : ${contact}`);
      }
      const id = `agr_${Date.now()}`;
      return { agreementId: id, terms, status: "sent" };
    },
    compensate: async ({ agreementId }) => {
      return { status: "voided" };
    },
  },
  {
    name: "setup_tracking",
    description: "Configure le tracking des campagnes sur les plateformes.",
    parameters: [
      { name: "profileId", description: "ID du profil partenaire", required: true },
      { name: "platforms", description: "Plateformes (ex: youtube, instagram)", required: true },
    ],
    execute: async ({ profileId, platforms }) => {
      const id = `trk_${Date.now()}`;
      return { trackingId: id, platforms, status: "active" };
    },
    compensate: async ({ trackingId }) => {
      return { status: "disabled" };
    },
  },
  {
    name: "notify_team",
    description: "Notifie l'équipe interne de la collaboration.",
    parameters: [
      { name: "profileId", description: "ID du profil partenaire", required: true },
      { name: "channel", description: "Canal (slack, email)", required: true },
    ],
    execute: async ({ profileId, channel }) => {
      return { channel, status: "notified" };
    },
    compensate: async () => {
      return { status: "skipped" };
    },
  },
];

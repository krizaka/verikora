/**
 * The two sample leases of the recorded runs: fictitious (non-personal), one per side of the lease. They are the INPUT of the
 * recording (scripts/record-runs.mjs); what Sovkora returned is the recorded file next to them.
 */
export const SAMPLES = {
  tenant: {
    title: "Bail de logement — 4½, rue Saint-Denis (offert au locataire)",
    filename: "bail-saint-denis.txt",
    text: `BAIL DE LOGEMENT — 4½, rue Saint-Denis, Montréal
Entre le locateur Monsieur Marc Tremblay (fictif), domicilié à Montréal,
et la locataire Madame Sophie Gagnon (fictif).
Durée : 12 mois, du 1er juillet 2026 au 30 juin 2027.
Loyer mensuel : 1 450 $, payable le premier jour du mois.
La locataire verse un dépôt de sécurité de 1 450 $ à la signature.
La locataire remet douze chèques postdatés.
Il est interdit d'avoir des enfants dans le logement.`,
  },
  landlord: {
    title: "Modèle de bail — 3½, avenue du Parc (du locateur, avant envoi)",
    filename: "modele-bail-avenue-du-parc.txt",
    text: `MODÈLE DE BAIL — 3½, avenue du Parc, Montréal
Entre la locatrice Madame Hélène Roy (fictif), domiciliée à Montréal,
et le locataire Monsieur Karim Haddad (fictif), domicilié à Laval.
Durée : 12 mois, du 1er septembre 2026 au 31 août 2027.
Loyer mensuel : 1 120 $, payable le premier jour du mois.
Le locataire verse un dépôt de garantie équivalant à un mois de loyer à la signature.
Le locataire renonce à son droit au maintien dans les lieux à la fin du bail.`,
  },
};

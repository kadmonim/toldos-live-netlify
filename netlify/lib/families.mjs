// The families this installation serves. One is enough: every address shows the first one.
// To serve a second family from the same site and database, add an entry with its own address
// in `hosts` and its top couple's id in `root`.
//   key       short lowercase name, used for the login cookie and APP_PASSWORD_<KEY>
//   hosts     the addresses that show this family (without www); an address that isn't listed
//             anywhere shows the first family
//   he, en    the family name in Hebrew and English, shown in titles and headings
//   lang      the language a visitor sees first ('en' or 'he'); they can switch with EN/עב
//   root      the top couple (couples.id); null means the couple marked is_root in the database
//   complete  true when the top couple's children are all in the tree, so nobody is added there
//   password  the secret APP_PASSWORD_<KEY>, or APP_PASSWORD while that isn't set
//   og        the link-preview image in public/ (public, so WhatsApp can show it); none if not set
//   preview   optional { site, title, description } for the link preview
//   admin     the app admin for this family (people.id), when it isn't ADMIN below
// Shared by the functions and the page (src/main.js), so it holds nothing secret.
export const FAMILIES = [
  { key: 'rosenfeld', hosts: [], he: 'רוזנפלד', en: 'Rosenfeld', lang: 'en', root: null, complete: false },
];

/** The app admin: a person in the tree (people.id). People ask them, by WhatsApp to the phone on
 *  their profile, to turn on exporting a branch for them (people.can_export). */
export const ADMIN = '118e8571-5c4b-4bac-a34b-a1c069cfbd75';   // Yitzchak Rosenfeld (in the invented starting family)
export const adminOf = (family) => family.admin ?? ADMIN;

/** The family whose site this address is. */
export function familyOfHost(hostname) {
  const host = hostname.replace(/^www\./, '');
  return FAMILIES.find((f) => f.hosts.includes(host)) ?? FAMILIES[0];
}

/** The family of the site this request came to. */
export const familyOf = (req) => familyOfHost(new URL(req.url).hostname);

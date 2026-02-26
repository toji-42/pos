# Logiciel de Caisse (Expo React Native)

## Lancement

```bash
cd caisse-pos
npm install
npm run android
```

Si l'émulateur tablette perd la connexion Expo Go (`ERR_NETWORK_CHANGED`), utilise le mode stable :

```bash
npm run android:stable
```

## Comptes en dur

- `staff` / `1234`
- `admin` / `9999`

## Fonctionnalités implémentées

- UX caisse tablette (mode paysage, thème noir/vert)
- Catalogue produits seedé depuis `Liste des articles.xlsx` dans SQLite local
- Photos produits reliées automatiquement par `imageKey`
- Panier rapide tactile (+ / -)
- Envoi ticket cuisine
- Encaissement carte / espèces
- Stockage local SQLite (aucune base externe)
- Rôles et droits :
  - `staff`: prise de commande + encaissement
  - `admin`: remise 10%, stats du jour, configuration imprimantes, upload produits, activation/désactivation stock
- Double imprimante Epson (caisse + cuisine) via endpoint ePOS

## Gestion produits (admin uniquement)

- `Upload produits (JSON)` dans le panneau admin permet d'importer/modifier des articles.
- Le stock est piloté par un statut `Actif / Inactif` (seul l'admin peut changer ce statut).
- Les produits `Inactif` ne s'affichent plus dans la grille de vente.

Format JSON attendu :

```json
[
  {
    "name": "Big'S",
    "price": 4.95,
    "category": "burgers",
    "sendToKitchen": true,
    "active": true,
    "imageKey": "le_bigs"
  }
]
```

`category` accepté: `burgers`, `snacks`, `desserts`, `boissons`.

## Configuration imprimantes Epson

Dans la section Admin, renseigner :

- URL imprimante caisse
- URL imprimante cuisine

Exemple URL Epson ePOS :

```txt
http://192.168.1.50/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000
```

Si seule l'IP est fournie (ex: `http://192.168.1.50`), l'application ajoute automatiquement le chemin ePOS.

## Structure principale

- `App.tsx` : écrans login + POS
- `src/auth/users.ts` : comptes statiques
- `src/data/seedProducts.ts` : seed initial des articles
- `src/data/database.ts` : SQLite local (orders + settings + products)
- `src/services/epson.ts` : impression caisse / cuisine

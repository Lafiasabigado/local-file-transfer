# LocalShare 

L'alternative cross-platform et sécurisée pour votre réseau local.

LocalShare est une application de bureau et mobile légère, rapide et universelle permettant d'échanger des fichiers de n'importe quelle taille entre vos différents appareils. Conçue pour une simplicité absolue, elle fonctionne instantanément sans configuration et sans dépendance à internet, tout en chiffrant l'intégralité de vos transferts.

---

## Fonctionnalités

* Transfert ultra-rapide : Exploite la pleine vitesse de votre réseau local Wi-Fi.
* Connexion simplifiée : Partagez via un Code PIN à 6 chiffres.
* Drag & Drop : Glissez simplement vos fichiers dans la fenêtre pour démarrer l'envoi.
* Support multi-fichiers : Transférez plusieurs documents simultanément avec barre de progression intégrée.
* Chiffrement de bout-en-bout : Fichiers sécurisés par AES-GCM (Web Crypto API) à la volée.
* Multilingue : Bascule instantanée entre le Français et l'Anglais.
* Historique local : Retrouvez l'historique complet de vos transferts passés.
* Interface premium : Un design moderne, épuré et minimaliste typé Glassmorphism.

---

## Téléchargement

LocalShare est disponible gratuitement pour votre système d'exploitation de bureau (Windows/Mac/Linux) ainsi que sur mobile (Android). 

Téléchargez la dernière version depuis la page Releases GitHub :
[https://github.com/Lafiasabigado/local-file-transfer/releases/latest](https://github.com/Lafiasabigado/local-file-transfer/releases/latest)

- Windows : Téléchargez le fichier `.exe`
- macOS : Téléchargez le fichier `.dmg`
- Linux : Téléchargez le fichier `.AppImage`
- Android : Téléchargez le fichier `.apk`

---

## Installation

Fini les configurations réseaux compliquées. L'installation de LocalShare est immédiate :

1. Téléchargez le fichier d'installation correspondant à votre OS dans les Releases GitHub.
2. Lancez l'installateur.
3. Ouvrez l'application.

Vous y êtes ! Tout fonctionne automatiquement. Le serveur Node discret tourne de lui-même en arrière-plan.

---

## Utilisation

Transférer un fichier n'a jamais été aussi simple :

Sur l'Appareil A (Émetteur) :
1. Ouvrez l'application et cliquez sur "Envoyer".
2. Glissez vos fichiers vers la zone cible.
3. L'application génère immédiatement un Code à 6 chiffres.

Sur l'Appareil B (Récepteur) :
1. Sur un autre ordinateur ou un smartphone, ouvrez l'application et cliquez sur "Recevoir".
2. Saisissez l'Adresse IP de l'émetteur et le Code PIN à 6 chiffres.
3. Le transfert sécurisé démarre aussitôt et votre fichier est prêt à être téléchargé.

---

## Sécurité & Confidentialité

Votre vie privée est respectée par design :
- Réseau Local Exclusivement : Vos données personnelles ou sensibles ne transitent par aucun serveur externe. Elles vont directement de votre point A à votre point B.
- Chiffrement Dynamique : Chaque envoi déclenche une génération de clé d'échange asymétrique indéchiffrable par un tiers pour sécuriser tout le trafic Wi-Fi environnant. Si le TLS n'est pas disponible, LocalShare utilise un transfert haut débit en mode Streaming local pour éviter de surcharger la mémoire de votre appareil.

---

## Développement

Vous souhaitez contribuer ou modifier LocalShare ? 

L'architecture s'appuie sur une coquille Electron combinée de manière transparente à un serveur Node.js embarqué.

```bash
# 1. Cloner le projet
git clone https://github.com/Lafiasabigado/local-file-transfer.git
cd local-file-transfer

# 2. Installer les dépendances
npm install

# 3. Lancer l'application en mode développement
npm start
```

---

## Build de l'application

Pour générer vous-même les fichiers d'installation finaux pour distribution :

```bash
# Générer les binaires avec Electron Builder
npm run build:win   # Pour Windows (.exe)
npm run build:mac   # Pour macOS (.dmg)
npm run build:linux # Pour Linux (.AppImage)
```
Les fichiers packagés seront générés automatiquement dans le dossier `dist/`.

---

## Technologies Utilisées

* Node.js : Propulsion du serveur local et gestion des websockets de signalisation.
* Electron : Encapsulation applicative cross-platform sur Desktop.
* API Android : Pour générer l'Application Android.
* HTML / CSS / JavaScript : Interface entièrement conçue sans Framework lourd ni bibliothèque CSS externe. (Aucun portail de CDN n'est interrogé, garantissant l'aspect Hors-ligne étanche).

---

## Roadmap & À venir

- [ ] Transition réseau en WebRTC pour des transferts purement Peer-to-peer en décharge sans serveur de relais sur fichiers volumineux.
- [ ] Application iOS dédiée.
- [ ] Support d'avatars systèmes entre appareils trouvés.

# Lichess — parties par correspondance

Petit site local pour visualiser les parties par correspondance d'un joueur lichess :

- ai-je lancé une partie chaque jour ? (calendrier, jours manqués, série en cours / record)
- quelle est ma plus vieille partie en cours ?
- suis-je assidu ? (parties perdues au temps, nombre moyen de coups, bilan V/N/D)
- tableau triable et filtrable de toutes les parties (en cours, à toi de jouer, terminées),
  avec le rythme de chaque partie en coups/jour

Un clic sur un jour du calendrier filtre le tableau sur les parties démarrées ce jour-là,
et un clic sur une ligne ouvre la partie sur lichess.

## Lancer

```sh
npm install
npm run dev
```

Puis ouvrir http://localhost:5173/?u=pseudo

## Notes

- Tout se passe dans le navigateur, qui appelle directement l'API publique de lichess (sans token).
- Le premier chargement est limité par lichess à ~20 parties/s. Les parties sont ensuite mises en cache
  dans le `localStorage` et « Rafraîchir » ne retélécharge que ce qui peut avoir changé.
- Un jour compte comme « joué » dès qu'une partie par correspondance a été créée ce jour-là
  (fuseau horaire local), quel que soit le joueur qui a lancé le défi.
- lichess masque les derniers coups des parties en cours dans ses exports ; l'app compense
  pour savoir correctement à qui c'est le tour de jouer.

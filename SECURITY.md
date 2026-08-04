# Sicherheitshinweis

Der Ordner `.private/` enthält sensible lokale Daten
und ist über `.gitignore` vom Commit ausgeschlossen.

**Niemals committen:**
- `.private/` Ordner und Inhalte
- Dateien mit Kundendaten
- API-Keys oder Passwörter

Falls du versehentlich sensible Daten committed hast:
1. `git rm -r --cached .private/`
2. `git commit -m "Remove private data"`
3. Passwörter/Keys sofort rotieren

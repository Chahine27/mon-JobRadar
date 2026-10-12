' Lance Job Radar sans aucune fenetre (meme avec Windows Terminal comme console par defaut). Voir lancer.ps1
' Pour arreter : bouton "Arreter Job Radar" en bas du menu du site.
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "lancer.ps1")
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & script & """", 0, False

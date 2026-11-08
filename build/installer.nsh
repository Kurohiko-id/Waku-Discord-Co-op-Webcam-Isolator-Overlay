; Bahasa yang dipilih di installer menjadi bahasa awal Waku (dibaca electron/main.js kalau belum ada pilihan
; dari tombol ID/EN). 1057 = Indonesian, selain itu English.
!macro customInstall
  FileOpen $0 "$INSTDIR\install-lang" w
  ${If} $LANGUAGE == 1057
    FileWrite $0 "id"
  ${Else}
    FileWrite $0 "en"
  ${EndIf}
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\install-lang"
!macroend

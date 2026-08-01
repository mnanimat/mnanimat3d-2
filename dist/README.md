# MNAnimat3D v2.1

Editor de modelagem, montagem de cenário, rig e animação 3D para Windows e Android.

## Alterações desta versão

- Rain e Snow foram removidas da interface, do instalador Windows, do APK e da pasta de assets.
- A personagem blocada do pacote Kenney Blocky Characters permanece incluída sob CC0.
- Novo cartão **Importar personagem FBX**, com suporte a:
  - armatures e ossos;
  - animações existentes no FBX;
  - controladores visuais nas articulações principais;
  - seleção conjunta do `.fbx` e de texturas PNG/JPG/WebP/BMP/TGA;
  - registro de autoria, licença, fonte e texto de crédito;
  - preenchimento opcional para arquivos realmente obtidos do pacote Quaternius **Modular Character Outfits – Fantasy**, sob CC0.
- Seleção múltipla com `Shift` no Windows e botão **Multi** no Android.
- Modo **Pose direta** para tocar ou clicar e arrastar articulações.
- Timeline Android compacta em orientação horizontal.

## Importar um personagem FBX da Quaternius

1. Acesse `https://quaternius.com/packs/modularcharacteroutfitsfantasy.html`.
2. Baixe e extraia o pacote.
3. No MNAnimat3D, abra **Assets**.
4. Clique em **Escolher FBX** no cartão **Importar personagem FBX**.
5. Selecione o arquivo `.fbx` e, se houver, suas texturas na mesma janela. Use `Ctrl` ou `Shift` no Windows para selecionar vários arquivos.
6. Na janela de licença, clique em **Preencher Quaternius CC0** somente quando o arquivo realmente veio desse pacote.
7. Confirme a importação. Ossos e animações disponíveis serão carregados automaticamente.

O pacote citado é disponibilizado pela Quaternius em FBX, OBJ, Blend e glTF e identificado na página oficial como CC0, inclusive para projetos comerciais. Crédito não é obrigatório sob CC0, mas pode ser mantido por transparência.

## Executar no Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\run-mnanimat3d.ps1
```

Depois abra `http://localhost:4173/`.

## Gerar o instalador Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\packaging\windows\Build-Installer.ps1
```

Resultado:

```text
dist\windows\MNAnimat3D-Setup.exe
```

## Gerar o APK Android

Abra a pasta `android` no Android Studio e use **Build > Build APK(s)**, ou execute:

```powershell
cd android
.\gradlew.bat assembleDebug
```

## Observações sobre FBX

- O importador usa o `FBXLoader` oficial compatível com Three.js r179.
- Alguns FBX dependem de texturas externas. Selecione o FBX e as imagens juntas no cartão de importação.
- Caso um modelo específico apresente incompatibilidade, use a versão glTF/GLB do mesmo pacote quando disponível.
- Importe somente modelos próprios ou para os quais você tenha permissão de uso.

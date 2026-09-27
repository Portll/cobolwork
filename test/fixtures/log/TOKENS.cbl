       IDENTIFICATION DIVISION.
       PROGRAM-ID. TOKENS.
      * Tokens that are credentials, by name or by where they came from.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT KEYS-FILE ASSIGN TO "secrets.dat".
       DATA DIVISION.
       FILE SECTION.
       FD KEYS-FILE.
       01 KEYS-REC.
          05 KR-TOKEN         PIC X(40).
       WORKING-STORAGE SECTION.
       01 WS-ACCESS-TOKEN     PIC X(40).
       01 WS-TOKEN            PIC X(40).
       PROCEDURE DIVISION.
           ACCEPT WS-TOKEN FROM ENVIRONMENT "GITHUB_TOKEN"
           OPEN INPUT KEYS-FILE
           READ KEYS-FILE
           MOVE KR-TOKEN TO WS-ACCESS-TOKEN
           DISPLAY WS-ACCESS-TOKEN
           DISPLAY WS-TOKEN
           DISPLAY KR-TOKEN
           CLOSE KEYS-FILE
           GOBACK.

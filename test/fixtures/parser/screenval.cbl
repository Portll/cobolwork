       IDENTIFICATION DIVISION.
       PROGRAM-ID. SCREENV.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-BET              PIC 999.
       SCREEN SECTION.
       01  BOARD.
           05 BLANK SCREEN.
           05 LINE 1 COL 13 VALUE 4.
           05 LINE 2 COL 12 VALUE 10.
           05 LINE 3 COL 9 VALUE "BET:".
           05 LINE 3 COL 20 PIC 999 USING WS-BET.
       01  RUNON.
           05 LINE 1 COLUMN 1 VALUE "Add Account:"
           05 LINE 3 COLUMN 1 VALUE "         ID: ".
           05 LINE 5 COLUMN 1 VALUE "F1" HIGHLIGHT.
       PROCEDURE DIVISION.
           DISPLAY BOARD
           STOP RUN.

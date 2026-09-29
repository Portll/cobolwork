       IDENTIFICATION DIVISION.
       PROGRAM-ID. CORRQUAL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FLAGS.
          05 WS-MODE PIC X.
             88 MODE-ON VALUE "Y".
       01 SRC-REC.
          05 F1 PIC 9.
          05 F2 PIC X.
          05 G1.
             10 F3 PIC 9.
          05 F4 PIC 9 OCCURS 2.
          05 FILLER PIC 9.
          05 F5 PIC 9.
          05 F6 REDEFINES F5 PIC 9.
       01 DST-REC.
          05 F1 PIC 9.
          05 F2 PIC X.
          05 G1.
             10 F3 PIC 9.
          05 F4 PIC 9 OCCURS 2.
          05 FILLER PIC 9.
          05 F6 PIC 9.
          05 F7 PIC 9.
       PROCEDURE DIVISION.
           IF MODE-ON IN WS-MODE
               MOVE CORRESPONDING SRC-REC TO DST-REC
           END-IF
           GOBACK.

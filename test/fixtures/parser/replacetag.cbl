       REPLACE ==:BUFSZ:== BY ==40==.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. REPLTAG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-BUFFER           PIC X(:BUFSZ:).
       REPLACE ==:TAG:== BY ==PAY==.
       01  :TAG:-REC.
           05 :TAG:-WEEK       PIC S99.
           05 :TAG:-GROSS      PIC S9(5)V99.
       REPLACE ==01  OLD-ITEM  PICTURE X.== BY
               ==01  NEW-ITEM  PICTURE S9(7) COMP.==.
       01  OLD-ITEM  PICTURE X.
       REPLACE OFF.
       01  WS-AFTER            PIC X(4).
       PROCEDURE DIVISION.
           MOVE 1 TO PAY-WEEK NEW-ITEM
           MOVE SPACES TO WS-BUFFER
           STOP RUN.

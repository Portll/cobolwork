       IDENTIFICATION DIVISION.
       PROGRAM-ID. NUMBERS.
      * Numbers named after credentials, and one PIN that is a PIN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-TOKEN-COUNT      PIC 9(3) VALUE 0.
       01 WK-PWD              PIC 9(4) VALUE ZERO.
       01 WS-SECRET-NUMBER    PIC 9(16) COMP.
       01 LOCK-PIN-HEIGHT     PIC 9.
       01 WS-PASSWORD-R       PIC S9(3) COMP-5.
       01 WS-CARD-PIN         PIC 9(4).
       PROCEDURE DIVISION.
           ADD 1 TO WS-TOKEN-COUNT
           ADD 1 TO WK-PWD
           DISPLAY WS-TOKEN-COUNT
           DISPLAY WK-PWD
           DISPLAY WS-SECRET-NUMBER
           DISPLAY LOCK-PIN-HEIGHT
           DISPLAY WS-PASSWORD-R
           DISPLAY WS-CARD-PIN
           GOBACK.

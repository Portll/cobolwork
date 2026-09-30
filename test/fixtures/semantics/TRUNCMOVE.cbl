       CBL TRUNC(OPT)
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TRUNCMOVE.
      * A counter kept in a halfword, filled from a nine-digit total.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-TOTAL   PIC S9(9) COMP-3.
       01 WS-COUNT   PIC S9(4) COMP.
       01 WS-NATIVE  PIC S9(4) COMP-5.
       01 WS-WIDE    PIC S9(9) BINARY.
       PROCEDURE DIVISION.
           MOVE WS-TOTAL TO WS-COUNT
           MOVE WS-TOTAL TO WS-NATIVE
           MOVE WS-TOTAL TO WS-WIDE
           MOVE 123456 TO WS-COUNT
           GOBACK.

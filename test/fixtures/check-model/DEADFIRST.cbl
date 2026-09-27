       IDENTIFICATION DIVISION.
       PROGRAM-ID. DEADFIRST.
      * The first use in the source is one the GO TO jumps over; the
      * second runs.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-I FROM COMMAND-LINE
           GO TO LIVE-PARA.
       DEAD-PARA.
           MOVE 'X' TO WS-ENTRY(WS-I).
       LIVE-PARA.
           MOVE 'Y' TO WS-ENTRY(WS-I)
           GOBACK.

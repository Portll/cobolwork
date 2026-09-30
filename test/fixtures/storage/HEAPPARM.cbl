       IDENTIFICATION DIVISION.
       PROGRAM-ID. HEAPPARM.
      * A batch program sizes a heap request from its command line.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-ARG        PIC X(8).
       01 WS-SIZE       PIC S9(9) COMP.
       01 WS-HEAP       PIC S9(9) COMP VALUE 0.
       01 WS-ADDR       USAGE POINTER.
       01 WS-FC         PIC X(12).
       PROCEDURE DIVISION.
           ACCEPT WS-ARG FROM COMMAND-LINE
           MOVE WS-ARG TO WS-SIZE
           CALL 'CEEGTST' USING WS-HEAP WS-SIZE WS-ADDR WS-FC
           GOBACK.

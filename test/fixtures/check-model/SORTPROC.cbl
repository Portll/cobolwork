       IDENTIFICATION DIVISION.
       PROGRAM-ID. SORTPROC.
      * The index is used in a SORT's input procedure, which nothing
      * else performs.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SORT-FILE ASSIGN TO SORTWK.
       DATA DIVISION.
       FILE SECTION.
       SD SORT-FILE.
       01 SORT-REC             PIC X(10).
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-I FROM COMMAND-LINE
           SORT SORT-FILE ON ASCENDING KEY SORT-REC
               INPUT PROCEDURE IS FEED-SORT
               GIVING SORT-FILE
           STOP RUN.
       FEED-SORT.
           MOVE WS-ENTRY(WS-I) TO SORT-REC
           RELEASE SORT-REC.
